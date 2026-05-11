import 'package:flutter/foundation.dart';
import '../models/sim_card.dart';
import '../services/sms_service.dart';
import '../services/storage_service.dart';

class AppProvider extends ChangeNotifier {
  final StorageService _storage = StorageService.instance;

  String _trackerNumber = '';
  String _selectedDevice = '';
  bool _isDarkMode = false;
  String _language = 'en';
  bool _isLoading = false;
  List<SimCard> _simCards = [];
  int? _selectedSimSubscriptionId;

  AppProvider() {
    _loadSettings();
    _loadSimCards();
  }

  String get trackerNumber => _trackerNumber;
  String get selectedDevice => _selectedDevice;
  bool get isDarkMode => _isDarkMode;
  String get language => _language;
  bool get isLoading => _isLoading;
  bool get isSomali => _language == 'so';
  List<SimCard> get simCards => _simCards;
  int? get selectedSimSubscriptionId => _selectedSimSubscriptionId;
  SimCard? get selectedSim => _simCards.isEmpty
      ? null
      : _simCards.firstWhere(
          (s) => s.subscriptionId == _selectedSimSubscriptionId,
          orElse: () => _simCards.first,
        );

  Future<void> _loadSettings() async {
    _isDarkMode = _storage.isDarkMode;
    _language = _storage.language;
    notifyListeners();
  }

  Future<void> _loadSimCards() async {
    _simCards = await SmsService.instance.getSimCards();
    if (_simCards.isNotEmpty && _selectedSimSubscriptionId == null) {
      _selectedSimSubscriptionId = _simCards.first.subscriptionId;
    }
    notifyListeners();
  }

  void selectSim(int subscriptionId) {
    _selectedSimSubscriptionId = subscriptionId;
    notifyListeners();
  }

  void setTrackerNumber(String number) {
    _trackerNumber = number;
    notifyListeners();
  }

  void setSelectedDevice(String device) {
    _selectedDevice = device;
    notifyListeners();
  }

  Future<void> saveSession() async {
    if (_trackerNumber.isNotEmpty && _selectedDevice.isNotEmpty) {
      await _storage.saveSession(_trackerNumber, _selectedDevice);
    }
  }

  Future<void> toggleDarkMode() async {
    _isDarkMode = !_isDarkMode;
    await _storage.setDarkMode(_isDarkMode);
    notifyListeners();
  }

  Future<void> setLanguage(String lang) async {
    _language = lang;
    await _storage.setLanguage(lang);
    notifyListeners();
  }

  void setLoading(bool value) {
    _isLoading = value;
    notifyListeners();
  }

  List<Map<String, String>> getRecentSessions() {
    return _storage.getRecentSessions();
  }
}
