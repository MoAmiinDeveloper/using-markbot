class CustomServer {
  final String id;
  final String name;
  final String host;
  final String port;

  const CustomServer({
    required this.id,
    required this.name,
    required this.host,
    required this.port,
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'host': host,
        'port': port,
      };

  factory CustomServer.fromJson(Map<String, dynamic> json) {
    return CustomServer(
      id: json['id'] as String,
      name: json['name'] as String,
      host: json['host'] as String,
      port: json['port'] as String,
    );
  }

  Map<String, dynamic> toPreset() => {
        'name': name,
        'host': host,
        'port': port,
        'description': host,
      };
}
