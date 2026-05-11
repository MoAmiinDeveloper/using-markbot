import 'package:flutter/foundation.dart';
import '../data/commands_data.dart';
import '../models/command_model.dart';
import '../models/command_field_model.dart';
import '../models/custom_command.dart';
import '../models/command_history_model.dart';
import '../services/storage_service.dart';
import '../services/sms_service.dart';

class CommandProvider extends ChangeNotifier {
  final StorageService _storage = StorageService.instance;
  final SmsService _sms = SmsService.instance;

  List<CommandModel> _allCommands = [];
  List<CommandModel> _filteredCommands = [];
  CommandCategory? _selectedCategory;
  String _searchQuery = '';
  CommandHistoryModel? _lastGeneratedCommand;
  List<CommandHistoryModel> _history = [];
  List<FavoriteCommand> _favorites = [];
  bool _isSending = false;
  String? _lastError;

  CommandProvider() {
    _reloadCommands();
    _loadPersistentData();
  }

  void _reloadCommands() {
    final custom = _storage.getCustomCommands().map(_toCommandModel).toList();
    _allCommands = [...CommandsData.commands, ...custom];
    _applyFilters();
  }

  CommandModel _toCommandModel(CustomCommand c) {
    CommandCategory cat;
    switch (c.category) {
      case 'network': cat = CommandCategory.network; break;
      case 'tracking': cat = CommandCategory.tracking; break;
      case 'outputs': cat = CommandCategory.outputs; break;
      case 'bluetooth': cat = CommandCategory.bluetooth; break;
      default: cat = CommandCategory.system;
    }
    return CommandModel(
      id: 'custom_${c.id}',
      name: c.name,
      nameSo: c.name,
      description: c.description.isEmpty ? c.template : c.description,
      descriptionSo: c.description.isEmpty ? c.template : c.description,
      category: cat,
      template: c.template,
      fields: const [],
    );
  }

  void refreshCustomCommands() {
    _reloadCommands();
    notifyListeners();
  }

  List<CommandModel> get filteredCommands => _filteredCommands;
  CommandCategory? get selectedCategory => _selectedCategory;
  String get searchQuery => _searchQuery;
  CommandHistoryModel? get lastGeneratedCommand => _lastGeneratedCommand;
  List<CommandHistoryModel> get history => _history;
  List<FavoriteCommand> get favorites => _favorites;
  bool get isSending => _isSending;
  String? get lastError => _lastError;

  Future<void> _loadPersistentData() async {
    _history = _storage.getHistory();
    _favorites = _storage.getFavorites();
    notifyListeners();
  }

  void filterByDevice(String deviceId) {
    final custom = _storage.getCustomCommands().map(_toCommandModel).toList();
    _allCommands = [...CommandsData.getByModel(deviceId), ...custom];
    _applyFilters();
  }

  void setCategory(CommandCategory? category) {
    _selectedCategory = category;
    _applyFilters();
  }

  void search(String query) {
    _searchQuery = query;
    _applyFilters();
  }

  void _applyFilters() {
    List<CommandModel> result = _allCommands;

    if (_selectedCategory != null) {
      result = result.where((c) => c.category == _selectedCategory).toList();
    }

    if (_searchQuery.isNotEmpty) {
      final q = _searchQuery.toLowerCase();
      result = result.where((c) {
        return c.name.toLowerCase().contains(q) ||
            c.nameSo.toLowerCase().contains(q) ||
            c.description.toLowerCase().contains(q) ||
            c.category.name.toLowerCase().contains(q);
      }).toList();
    }

    _filteredCommands = result;
    notifyListeners();
  }

  void generateSms(CommandModel command, Map<String, String> values,
      String trackerNumber, String deviceModel, {String? login, String? password}) {
    final smsText = command.generateSms(values, login: login, password: password);
    _lastGeneratedCommand = CommandHistoryModel(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      commandId: command.id,
      commandName: command.name,
      deviceModel: deviceModel,
      trackerNumber: trackerNumber,
      generatedSms: smsText,
      timestamp: DateTime.now(),
      fieldValues: values,
    );
    notifyListeners();
  }

  Future<SmsResult> sendSms({int? subscriptionId}) async {
    if (_lastGeneratedCommand == null) return SmsResult.failed;

    _isSending = true;
    _lastError = null;
    notifyListeners();

    final result = await _sms.sendSms(
      phoneNumber: _lastGeneratedCommand!.trackerNumber,
      message: _lastGeneratedCommand!.generatedSms,
      subscriptionId: subscriptionId,
    );

    if (result == SmsResult.sent) {
      final sentCommand = _lastGeneratedCommand!.copyWith(sent: true);
      await _storage.addHistory(sentCommand);
      _history.insert(0, sentCommand);
    } else {
      _lastError = result == SmsResult.permissionDenied
          ? 'SMS permission denied'
          : 'Failed to send SMS';
      // Still save to history as unsent
      await _storage.addHistory(_lastGeneratedCommand!);
      _history.insert(0, _lastGeneratedCommand!);
    }

    _isSending = false;
    notifyListeners();
    return result;
  }

  Future<void> resendFromHistory(CommandHistoryModel item) async {
    _lastGeneratedCommand = item;
    await sendSms();
  }

  Future<void> clearHistory() async {
    await _storage.clearHistory();
    _history.clear();
    notifyListeners();
  }

  Future<void> deleteHistoryItem(String id) async {
    await _storage.deleteHistoryItem(id);
    _history.removeWhere((h) => h.id == id);
    notifyListeners();
  }

  bool isFavorite(String commandId) => _storage.isFavorite(commandId);

  Future<void> toggleFavorite(String commandId, String commandName, String category) async {
    await _storage.toggleFavorite(commandId, commandName, category);
    _favorites = _storage.getFavorites();
    notifyListeners();
  }

  Map<CommandCategory, List<CommandModel>> getGroupedCommands() {
    final Map<CommandCategory, List<CommandModel>> grouped = {};
    for (final cmd in _filteredCommands) {
      grouped.putIfAbsent(cmd.category, () => []).add(cmd);
    }
    return grouped;
  }

  void clearLastGenerated() {
    _lastGeneratedCommand = null;
    notifyListeners();
  }
}
