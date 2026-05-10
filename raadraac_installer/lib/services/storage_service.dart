import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:hive_flutter/hive_flutter.dart';
import '../models/command_history_model.dart';

class StorageService {
  static const String _historyBox = 'command_history';
  static const String _favoritesBox = 'favorites';
  static const String _settingsBox = 'settings';
  static const String _sessionsBox = 'sessions';

  static const String _keyDarkMode = 'dark_mode';
  static const String _keyLanguage = 'language';
  static const String _keyDefaultLogin = 'default_login';
  static const String _keyDefaultPassword = 'default_password';
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
}
