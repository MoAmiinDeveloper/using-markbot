import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../models/command_history_model.dart';
import '../models/custom_server.dart';
import '../models/apn_profile.dart';
import '../models/custom_command.dart';

class StorageService {
  static const String _historyBox = 'command_history';
  static const String _favoritesBox = 'favorites';
  static const String _settingsBox = 'settings';
  static const String _sessionsBox = 'sessions';
  static const String _customDataBox = 'custom_data';

  static const String _keyDarkMode = 'dark_mode';
  static const String _keyLanguage = 'language';
  static const String _keyDefaultLogin = 'default_login';
  static const String _keyDefaultPassword = 'default_password';
  static const String _keyServers = 'custom_servers';
  static const String _keyApnProfiles = 'apn_profiles';
  static const String _keyCustomCommands = 'custom_commands';
  static const int _maxHistoryItems = 100;

  static StorageService? _instance;
  static StorageService get instance => _instance ??= StorageService._();
  StorageService._();

  Future<void> init() async {
    await Hive.initFlutter();
    await Hive.openBox(_historyBox);
    await Hive.openBox(_favoritesBox);
    await Hive.openBox(_settingsBox);
    await Hive.openBox(_sessionsBox);
    await Hive.openBox(_customDataBox);
  }

  // ─── Settings ─────────────────────────────────────────────
  bool get isDarkMode {
    final box = Hive.box(_settingsBox);
    return box.get(_keyDarkMode, defaultValue: false) as bool;
  }

  Future<void> setDarkMode(bool value) async {
    final box = Hive.box(_settingsBox);
    await box.put(_keyDarkMode, value);
  }

  String get language {
    final box = Hive.box(_settingsBox);
    return box.get(_keyLanguage, defaultValue: 'en') as String;
  }

  Future<void> setLanguage(String lang) async {
    final box = Hive.box(_settingsBox);
    await box.put(_keyLanguage, lang);
  }

  String get defaultLogin {
    final box = Hive.box(_settingsBox);
    return box.get(_keyDefaultLogin, defaultValue: '') as String;
  }

  Future<void> setDefaultLogin(String login) async {
    final box = Hive.box(_settingsBox);
    await box.put(_keyDefaultLogin, login);
  }

  String get defaultPassword {
    final box = Hive.box(_settingsBox);
    return box.get(_keyDefaultPassword, defaultValue: '') as String;
  }

  Future<void> setDefaultPassword(String pwd) async {
    final box = Hive.box(_settingsBox);
    await box.put(_keyDefaultPassword, pwd);
  }

  // ─── Recent Sessions ──────────────────────────────────────
  List<Map<String, String>> getRecentSessions() {
    final box = Hive.box(_sessionsBox);
    final raw = box.get('sessions', defaultValue: '[]') as String;
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => Map<String, String>.from(e as Map)).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveSession(String trackerNumber, String deviceModel) async {
    final box = Hive.box(_sessionsBox);
    final sessions = getRecentSessions();
    sessions.removeWhere(
      (s) => s['trackerNumber'] == trackerNumber && s['deviceModel'] == deviceModel,
    );
    sessions.insert(0, {
      'trackerNumber': trackerNumber,
      'deviceModel': deviceModel,
      'lastUsed': DateTime.now().toIso8601String(),
    });
    if (sessions.length > 10) sessions.removeRange(10, sessions.length);
    await box.put('sessions', jsonEncode(sessions));
  }

  // ─── History ──────────────────────────────────────────────
  List<CommandHistoryModel> getHistory() {
    final box = Hive.box(_historyBox);
    final List<CommandHistoryModel> result = [];
    for (final key in box.keys) {
      try {
        final raw = box.get(key) as String?;
        if (raw != null) {
          result.add(CommandHistoryModel.fromJson(jsonDecode(raw) as Map<String, dynamic>));
        }
      } catch (e) {
        debugPrint('History parse error: $e');
      }
    }
    result.sort((a, b) => b.timestamp.compareTo(a.timestamp));
    return result;
  }

  Future<void> addHistory(CommandHistoryModel item) async {
    final box = Hive.box(_historyBox);
    await box.put(item.id, jsonEncode(item.toJson()));
    // Trim if too many
    if (box.length > _maxHistoryItems) {
      final keys = box.keys.toList();
      await box.delete(keys.first);
    }
  }

  Future<void> updateHistorySent(String id) async {
    final box = Hive.box(_historyBox);
    final raw = box.get(id) as String?;
    if (raw != null) {
      final item = CommandHistoryModel.fromJson(jsonDecode(raw) as Map<String, dynamic>);
      await box.put(id, jsonEncode(item.copyWith(sent: true).toJson()));
    }
  }

  Future<void> clearHistory() async {
    final box = Hive.box(_historyBox);
    await box.clear();
  }

  Future<void> deleteHistoryItem(String id) async {
    final box = Hive.box(_historyBox);
    await box.delete(id);
  }

  // ─── Favorites ────────────────────────────────────────────
  List<FavoriteCommand> getFavorites() {
    final box = Hive.box(_favoritesBox);
    final List<FavoriteCommand> result = [];
    for (final key in box.keys) {
      try {
        final raw = box.get(key) as String?;
        if (raw != null) {
          result.add(FavoriteCommand.fromJson(jsonDecode(raw) as Map<String, dynamic>));
        }
      } catch (e) {
        debugPrint('Favorites parse error: $e');
      }
    }
    return result;
  }

  bool isFavorite(String commandId) {
    final box = Hive.box(_favoritesBox);
    return box.containsKey(commandId);
  }

  Future<void> addFavorite(FavoriteCommand fav) async {
    final box = Hive.box(_favoritesBox);
    await box.put(fav.commandId, jsonEncode(fav.toJson()));
  }

  Future<void> removeFavorite(String commandId) async {
    final box = Hive.box(_favoritesBox);
    await box.delete(commandId);
  }

  Future<void> toggleFavorite(String commandId, String commandName, String category) async {
    if (isFavorite(commandId)) {
      await removeFavorite(commandId);
    } else {
      await addFavorite(FavoriteCommand(
        commandId: commandId,
        commandName: commandName,
        category: category,
        addedAt: DateTime.now(),
      ));
    }
  }

  // ─── Custom Servers ───────────────────────────────────────
  List<CustomServer> getCustomServers() {
    final box = Hive.box(_customDataBox);
    final raw = box.get(_keyServers, defaultValue: '[]') as String;
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => CustomServer.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveCustomServer(CustomServer server) async {
    final box = Hive.box(_customDataBox);
    final list = getCustomServers();
    final idx = list.indexWhere((s) => s.id == server.id);
    if (idx >= 0) {
      list[idx] = server;
    } else {
      list.add(server);
    }
    await box.put(_keyServers, jsonEncode(list.map((s) => s.toJson()).toList()));
  }

  Future<void> deleteCustomServer(String id) async {
    final box = Hive.box(_customDataBox);
    final list = getCustomServers()..removeWhere((s) => s.id == id);
    await box.put(_keyServers, jsonEncode(list.map((s) => s.toJson()).toList()));
  }

  // ─── APN Profiles ─────────────────────────────────────────
  List<ApnProfile> getApnProfiles() {
    final box = Hive.box(_customDataBox);
    final raw = box.get(_keyApnProfiles, defaultValue: '[]') as String;
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => ApnProfile.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveApnProfile(ApnProfile apn) async {
    final box = Hive.box(_customDataBox);
    final list = getApnProfiles();
    final idx = list.indexWhere((a) => a.id == apn.id);
    if (idx >= 0) {
      list[idx] = apn;
    } else {
      list.add(apn);
    }
    await box.put(_keyApnProfiles, jsonEncode(list.map((a) => a.toJson()).toList()));
  }

  Future<void> deleteApnProfile(String id) async {
    final box = Hive.box(_customDataBox);
    final list = getApnProfiles()..removeWhere((a) => a.id == id);
    await box.put(_keyApnProfiles, jsonEncode(list.map((a) => a.toJson()).toList()));
  }

  // ─── Custom Commands ──────────────────────────────────────
  List<CustomCommand> getCustomCommands() {
    final box = Hive.box(_customDataBox);
    final raw = box.get(_keyCustomCommands, defaultValue: '[]') as String;
    try {
      final list = jsonDecode(raw) as List;
      return list.map((e) => CustomCommand.fromJson(Map<String, dynamic>.from(e as Map))).toList();
    } catch (_) {
      return [];
    }
  }

  Future<void> saveCustomCommand(CustomCommand cmd) async {
    final box = Hive.box(_customDataBox);
    final list = getCustomCommands();
    final idx = list.indexWhere((c) => c.id == cmd.id);
    if (idx >= 0) {
      list[idx] = cmd;
    } else {
      list.add(cmd);
    }
    await box.put(_keyCustomCommands, jsonEncode(list.map((c) => c.toJson()).toList()));
  }

  Future<void> deleteCustomCommand(String id) async {
    final box = Hive.box(_customDataBox);
    final list = getCustomCommands()..removeWhere((c) => c.id == id);
    await box.put(_keyCustomCommands, jsonEncode(list.map((c) => c.toJson()).toList()));
  }
}
