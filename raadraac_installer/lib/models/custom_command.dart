class CustomCommand {
  final String id;
  final String name;
  final String template;
  final String category;
  final String description;

  const CustomCommand({
    required this.id,
    required this.name,
    required this.template,
    required this.category,
    this.description = '',
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'template': template,
        'category': category,
        'description': description,
      };

  factory CustomCommand.fromJson(Map<String, dynamic> json) {
    return CustomCommand(
      id: json['id'] as String,
      name: json['name'] as String,
      template: json['template'] as String,
      category: json['category'] as String,
      description: json['description'] as String? ?? '',
    );
  }
}
