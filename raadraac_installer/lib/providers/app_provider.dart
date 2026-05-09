import 'package:flutter/foundation.dart';
import '../services/storage_service.dart';

class AppProvider extends ChangeNotifier {
  final StorageService _storage = StorageService.instance;

  String _trackerNumber = '';
  String _selectedDevice = '';
  bool _isDarkMode = false;
  String _language = 'en';
  bool _isLoading = false;

  AppProvider() {
    _loadSettings();
  }

  String get trackerNumber => _trackerNumber;
  String get selectedDevice => _selectedDevice;
  bool get isDarkMode => _isDarkMode;
  String get language => _language;
  bool get isLoading => _isLoading;
  bool get isSomali => _language == 'so';

  Future<void> _loadSettings() async {
    _isDarkMode = _storage.isDarkMode;
    _language = _storage.language;
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
