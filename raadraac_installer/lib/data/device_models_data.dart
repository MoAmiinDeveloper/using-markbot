import '../models/device_model.dart';

class DeviceModelsData {
  static const List<DeviceModel> devices = [
    DeviceModel(
      id: 'FMC130',
      name: 'FMC130',
      description: 'Advanced CAN/OBD tracker with RS232/RS485',
      supportedCategories: ['system', 'network', 'tracking', 'outputs', 'bluetooth'],
      defaultPassword: '',
    ),
    DeviceModel(
      id: 'FMB920',
      name: 'FMB920',
      description: 'Compact GPS tracker with Bluetooth',
      supportedCategories: ['system', 'network', 'tracking', 'outputs', 'bluetooth'],
      defaultPassword: '',
    ),
    DeviceModel(
      id: 'FMC650',
      name: 'FMC650',
      description: 'Professional multi-functional tracker',
      supportedCategories: ['system', 'network', 'tracking', 'outputs', 'bluetooth'],
      defaultPassword: '',
    ),
    DeviceModel(
      id: 'FMT100',
      name: 'FMT100',
      description: 'Tachograph GPS tracker',
      supportedCategories: ['system', 'network', 'tracking', 'outputs'],
      defaultPassword: '',
    ),
    DeviceModel(
      id: 'FMB120',
      name: 'FMB120',
      description: 'Advanced tracker with OBD2 port',
      supportedCategories: ['system', 'network', 'tracking', 'outputs', 'bluetooth'],
      defaultPassword: '',
    ),
  ];

  static DeviceModel? getById(String id) {
    try {
      return devices.firstWhere((d) => d.id == id);
    } catch (_) {
      return null;
    }
  }
}
