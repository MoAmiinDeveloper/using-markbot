class SimCard {
  final int subscriptionId;
  final String displayName;
  final String number;
  final int slotIndex;

  const SimCard({
    required this.subscriptionId,
    required this.displayName,
    required this.number,
    required this.slotIndex,
  });

  factory SimCard.fromMap(Map<dynamic, dynamic> map) {
    return SimCard(
      subscriptionId: map['subscriptionId'] as int,
      displayName: map['displayName'] as String? ?? 'SIM ${(map['slotIndex'] as int? ?? 0) + 1}',
      number: map['number'] as String? ?? '',
      slotIndex: map['slotIndex'] as int? ?? 0,
    );
  }

  String get label {
    final name = displayName.isNotEmpty ? displayName : 'SIM ${slotIndex + 1}';
    return number.isNotEmpty ? '$name ($number)' : name;
  }
}
