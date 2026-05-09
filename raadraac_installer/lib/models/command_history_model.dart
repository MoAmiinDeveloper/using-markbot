class CommandHistoryModel {
  final String id;
  final String commandId;
  final String commandName;
  final String deviceModel;
  final String trackerNumber;
  final String generatedSms;
  final DateTime timestamp;
  final bool sent;
  final Map<String, String> fieldValues;

  CommandHistoryModel({
    required this.id,
    required this.commandId,
    required this.commandName,
    required this.deviceModel,
    required this.trackerNumber,
    required this.generatedSms,
    required this.timestamp,
    this.sent = false,
    this.fieldValues = const {},
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'commandId': commandId,
        'commandName': commandName,
        'deviceModel': deviceModel,
        'trackerNumber': trackerNumber,
        'generatedSms': generatedSms,
        'timestamp': timestamp.toIso8601String(),
        'sent': sent,
        'fieldValues': fieldValues,
      };

  factory CommandHistoryModel.fromJson(Map<String, dynamic> json) {
    return CommandHistoryModel(
      id: json['id'] as String,
      commandId: json['commandId'] as String,
      commandName: json['commandName'] as String,
      deviceModel: json['deviceModel'] as String,
      trackerNumber: json['trackerNumber'] as String,
      generatedSms: json['generatedSms'] as String,
      timestamp: DateTime.parse(json['timestamp'] as String),
      sent: json['sent'] as bool? ?? false,
      fieldValues: Map<String, String>.from(json['fieldValues'] as Map? ?? {}),
    );
  }

  CommandHistoryModel copyWith({bool? sent}) {
    return CommandHistoryModel(
      id: id,
      commandId: commandId,
      commandName: commandName,
      deviceModel: deviceModel,
      trackerNumber: trackerNumber,
      generatedSms: generatedSms,
      timestamp: timestamp,
      sent: sent ?? this.sent,
      fieldValues: fieldValues,
    );
  }
}

class FavoriteCommand {
  final String commandId;
  final String commandName;
  final String category;
  final DateTime addedAt;

  FavoriteCommand({
    required this.commandId,
    required this.commandName,
    required this.category,
    required this.addedAt,
  });

  Map<String, dynamic> toJson() => {
        'commandId': commandId,
        'commandName': commandName,
        'category': category,
        'addedAt': addedAt.toIso8601String(),
      };

  factory FavoriteCommand.fromJson(Map<String, dynamic> json) {
    return FavoriteCommand(
      commandId: json['commandId'] as String,
      commandName: json['commandName'] as String,
      category: json['category'] as String,
      addedAt: DateTime.parse(json['addedAt'] as String),
    );
  }
}
