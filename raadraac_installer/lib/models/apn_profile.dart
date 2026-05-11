class ApnProfile {
  final String id;
  final String name;
  final String apn;
  final String username;
  final String password;

  const ApnProfile({
    required this.id,
    required this.name,
    required this.apn,
    this.username = '',
    this.password = '',
  });

  Map<String, dynamic> toJson() => {
        'id': id,
        'name': name,
        'apn': apn,
        'username': username,
        'password': password,
      };

  factory ApnProfile.fromJson(Map<String, dynamic> json) {
    return ApnProfile(
      id: json['id'] as String,
      name: json['name'] as String,
      apn: json['apn'] as String,
      username: json['username'] as String? ?? '',
      password: json['password'] as String? ?? '',
    );
  }
}
