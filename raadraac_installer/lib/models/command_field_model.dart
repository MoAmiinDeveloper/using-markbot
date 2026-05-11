enum FieldType {
  text,
  number,
  dropdown,
  toggle,
  ipAddress,
  phone,
}

class CommandField {
  final String key;
  final String label;
  final String labelSo;
  final FieldType type;
  final String hint;
  final String hintSo;
  final bool required;
  final String? defaultValue;
  final List<String>? options;
  final String? validationPattern;
  final int? maxLength;
  final String? suffix;

  const CommandField({
    required this.key,
    required this.label,
    required this.labelSo,
    this.type = FieldType.text,
    this.hint = '',
    this.hintSo = '',
    this.required = true,
    this.defaultValue,
    this.options,
    this.validationPattern,
    this.maxLength,
    this.suffix,
  });
}

class ServerPreset {
  final String name;
  final String host;
  final int port;
  final String protocol;

  const ServerPreset({
    required this.name,
    required this.host,
    required this.port,
    required this.protocol,
  });
}
