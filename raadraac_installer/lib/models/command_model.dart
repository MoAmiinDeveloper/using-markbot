import 'command_field_model.dart';

enum CommandCategory {
  system,
  network,
  tracking,
  outputs,
  bluetooth,
}

extension CommandCategoryExtension on CommandCategory {
  String get name {
    switch (this) {
      case CommandCategory.system:
        return 'System';
      case CommandCategory.network:
        return 'Network';
      case CommandCategory.tracking:
        return 'Tracking';
      case CommandCategory.outputs:
        return 'Outputs';
      case CommandCategory.bluetooth:
        return 'Bluetooth';
    }
  }

  String get nameSo {
    switch (this) {
      case CommandCategory.system:
        return 'Nidaamka';
      case CommandCategory.network:
        return 'Shabakadda';
      case CommandCategory.tracking:
        return 'Raadraaca';
      case CommandCategory.outputs:
        return 'Wax soo saarka';
      case CommandCategory.bluetooth:
        return 'Bluetooth';
    }
  }

  String get icon {
    switch (this) {
      case CommandCategory.system:
        return '⚙️';
      case CommandCategory.network:
        return '🌐';
      case CommandCategory.tracking:
        return '📍';
      case CommandCategory.outputs:
        return '🔌';
      case CommandCategory.bluetooth:
        return '🔷';
    }
  }
}

class CommandModel {
  final String id;
  final String name;
  final String nameSo;
  final String description;
  final String descriptionSo;
  final CommandCategory category;
  final String template;
  final List<CommandField> fields;
  final List<String> supportedModels;
  final bool requiresPassword;
  final String? passwordTemplate;
  final bool isDangerous;
  final String? dangerMessage;

  const CommandModel({
    required this.id,
    required this.name,
    required this.nameSo,
    required this.description,
    required this.descriptionSo,
    required this.category,
    required this.template,
    this.fields = const [],
    this.supportedModels = const ['FMC130', 'FMB920', 'FMC650', 'FMT100', 'FMB120'],
    this.requiresPassword = false,
    this.passwordTemplate,
    this.isDangerous = false,
    this.dangerMessage,
  });

  String generateSms(Map<String, String> values, {String? login, String? password}) {
    String sms = template;

    for (final field in fields) {
      final value = values[field.key] ?? field.defaultValue ?? '';
      sms = sms.replaceAll('{${field.key}}', value);
    }

    final l = login ?? '';
    final p = password ?? '';
    sms = '$l $p $sms';

    return sms.trimRight();
  }
}
