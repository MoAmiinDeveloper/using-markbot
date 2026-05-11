class DeviceModel {
  final String id;
  final String name;
  final String description;
  final String imageAsset;
  final List<String> supportedCategories;
  final String defaultPassword;

  const DeviceModel({
    required this.id,
    required this.name,
    required this.description,
    this.imageAsset = '',
    this.supportedCategories = const [],
    this.defaultPassword = '',
  });
}
