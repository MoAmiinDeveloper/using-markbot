import 'package:flutter/material.dart';
import '../../core/constants/app_colors.dart';
import '../../models/custom_server.dart';
import '../../models/apn_profile.dart';
import '../../models/custom_command.dart';
import '../../services/storage_service.dart';

class ManageDataScreen extends StatefulWidget {
  const ManageDataScreen({super.key});

  @override
  State<ManageDataScreen> createState() => _ManageDataScreenState();
}

class _ManageDataScreenState extends State<ManageDataScreen>
    with SingleTickerProviderStateMixin {
  late TabController _tabs;

  @override
  void initState() {
    super.initState();
    _tabs = TabController(length: 3, vsync: this);
  }

  @override
  void dispose() {
    _tabs.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Manage Data'),
        bottom: TabBar(
          controller: _tabs,
          labelColor: AppColors.primary,
          indicatorColor: AppColors.primary,
          tabs: const [
            Tab(icon: Icon(Icons.dns_rounded), text: 'Servers'),
            Tab(icon: Icon(Icons.terminal_rounded), text: 'Commands'),
            Tab(icon: Icon(Icons.wifi_rounded), text: 'APN'),
          ],
        ),
      ),
      body: TabBarView(
        controller: _tabs,
        children: const [
          _ServersTab(),
          _CommandsTab(),
          _ApnTab(),
        ],
      ),
    );
  }
}

// ─── SERVERS TAB ──────────────────────────────────────────────────────────────

class _ServersTab extends StatefulWidget {
  const _ServersTab();

  @override
  State<_ServersTab> createState() => _ServersTabState();
}

class _ServersTabState extends State<_ServersTab> {
  List<CustomServer> _servers = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() => _servers = StorageService.instance.getCustomServers());
  }

  Future<void> _showForm({CustomServer? existing}) async {
    final nameCtrl = TextEditingController(text: existing?.name ?? '');
    final hostCtrl = TextEditingController(text: existing?.host ?? '');
    final portCtrl = TextEditingController(text: existing?.port ?? '');

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'Add Server' : 'Edit Server'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(labelText: 'Name', hintText: 'My Server'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: hostCtrl,
                decoration: const InputDecoration(labelText: 'Host / IP', hintText: '192.168.1.1'),
                keyboardType: TextInputType.url,
              ),
              const SizedBox(height: 8),
              TextField(
                controller: portCtrl,
                decoration: const InputDecoration(labelText: 'Port', hintText: '21212'),
                keyboardType: TextInputType.number,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty || hostCtrl.text.trim().isEmpty) return;
              final server = CustomServer(
                id: existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString(),
                name: nameCtrl.text.trim(),
                host: hostCtrl.text.trim(),
                port: portCtrl.text.trim().isEmpty ? '21212' : portCtrl.text.trim(),
              );
              await StorageService.instance.saveCustomServer(server);
              if (ctx.mounted) Navigator.pop(ctx);
              _load();
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.secondary,
        child: const Icon(Icons.add, color: AppColors.primary),
      ),
      body: _servers.isEmpty
          ? const _EmptyState(icon: Icons.dns_outlined, label: 'No custom servers yet')
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _servers.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final s = _servers[i];
                return _ItemCard(
                  title: s.name,
                  subtitle: '${s.host}:${s.port}',
                  icon: Icons.dns_rounded,
                  onEdit: () => _showForm(existing: s),
                  onDelete: () async {
                    await StorageService.instance.deleteCustomServer(s.id);
                    _load();
                  },
                );
              },
            ),
    );
  }
}

// ─── COMMANDS TAB ─────────────────────────────────────────────────────────────

class _CommandsTab extends StatefulWidget {
  const _CommandsTab();

  @override
  State<_CommandsTab> createState() => _CommandsTabState();
}

class _CommandsTabState extends State<_CommandsTab> {
  List<CustomCommand> _commands = [];

  final List<String> _categories = ['system', 'network', 'tracking', 'outputs', 'bluetooth'];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() => _commands = StorageService.instance.getCustomCommands());
  }

  Future<void> _showForm({CustomCommand? existing}) async {
    final nameCtrl = TextEditingController(text: existing?.name ?? '');
    final templateCtrl = TextEditingController(text: existing?.template ?? '');
    final descCtrl = TextEditingController(text: existing?.description ?? '');
    String selectedCategory = existing?.category ?? 'system';

    await showDialog(
      context: context,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setLocal) => AlertDialog(
          title: Text(existing == null ? 'Add Command' : 'Edit Command'),
          content: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: nameCtrl,
                  decoration: const InputDecoration(labelText: 'Name', hintText: 'My Command'),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: templateCtrl,
                  decoration: const InputDecoration(
                    labelText: 'SMS Template',
                    hintText: 'setparam 1234:value',
                  ),
                  maxLines: 2,
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: descCtrl,
                  decoration: const InputDecoration(labelText: 'Description (optional)'),
                ),
                const SizedBox(height: 12),
                const Text('Category', style: TextStyle(fontSize: 12, color: Colors.grey)),
                const SizedBox(height: 4),
                DropdownButtonFormField<String>(
                  value: selectedCategory,
                  decoration: const InputDecoration(isDense: true),
                  items: _categories
                      .map((c) => DropdownMenuItem(
                            value: c,
                            child: Text(c[0].toUpperCase() + c.substring(1)),
                          ))
                      .toList(),
                  onChanged: (v) => setLocal(() => selectedCategory = v ?? 'system'),
                ),
              ],
            ),
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
            FilledButton(
              onPressed: () async {
                if (nameCtrl.text.trim().isEmpty || templateCtrl.text.trim().isEmpty) return;
                final cmd = CustomCommand(
                  id: existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString(),
                  name: nameCtrl.text.trim(),
                  template: templateCtrl.text.trim(),
                  category: selectedCategory,
                  description: descCtrl.text.trim(),
                );
                await StorageService.instance.saveCustomCommand(cmd);
                if (ctx.mounted) Navigator.pop(ctx);
                _load();
              },
              child: const Text('Save'),
            ),
          ],
        ),
      ),
    );
  }

  String _categoryIcon(String cat) {
    switch (cat) {
      case 'network': return '🌐';
      case 'tracking': return '📍';
      case 'outputs': return '🔌';
      case 'bluetooth': return '🔷';
      default: return '⚙️';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.secondary,
        child: const Icon(Icons.add, color: AppColors.primary),
      ),
      body: _commands.isEmpty
          ? const _EmptyState(icon: Icons.terminal_outlined, label: 'No custom commands yet')
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _commands.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final c = _commands[i];
                return _ItemCard(
                  title: '${_categoryIcon(c.category)} ${c.name}',
                  subtitle: c.template,
                  icon: Icons.terminal_rounded,
                  showIcon: false,
                  onEdit: () => _showForm(existing: c),
                  onDelete: () async {
                    await StorageService.instance.deleteCustomCommand(c.id);
                    _load();
                  },
                );
              },
            ),
    );
  }
}

// ─── APN TAB ──────────────────────────────────────────────────────────────────

class _ApnTab extends StatefulWidget {
  const _ApnTab();

  @override
  State<_ApnTab> createState() => _ApnTabState();
}

class _ApnTabState extends State<_ApnTab> {
  List<ApnProfile> _profiles = [];

  @override
  void initState() {
    super.initState();
    _load();
  }

  void _load() {
    setState(() => _profiles = StorageService.instance.getApnProfiles());
  }

  Future<void> _showForm({ApnProfile? existing}) async {
    final nameCtrl = TextEditingController(text: existing?.name ?? '');
    final apnCtrl = TextEditingController(text: existing?.apn ?? '');
    final userCtrl = TextEditingController(text: existing?.username ?? '');
    final passCtrl = TextEditingController(text: existing?.password ?? '');

    await showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Text(existing == null ? 'Add APN Profile' : 'Edit APN Profile'),
        content: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextField(
                controller: nameCtrl,
                decoration: const InputDecoration(labelText: 'Carrier Name', hintText: 'Somtel'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: apnCtrl,
                decoration: const InputDecoration(labelText: 'APN', hintText: 'internet'),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: userCtrl,
                decoration: const InputDecoration(
                  labelText: 'Username (optional)',
                  hintText: 'Leave blank if none',
                ),
              ),
              const SizedBox(height: 8),
              TextField(
                controller: passCtrl,
                decoration: const InputDecoration(
                  labelText: 'Password (optional)',
                  hintText: 'Leave blank if none',
                ),
                obscureText: true,
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty || apnCtrl.text.trim().isEmpty) return;
              final profile = ApnProfile(
                id: existing?.id ?? DateTime.now().millisecondsSinceEpoch.toString(),
                name: nameCtrl.text.trim(),
                apn: apnCtrl.text.trim(),
                username: userCtrl.text.trim(),
                password: passCtrl.text.trim(),
              );
              await StorageService.instance.saveApnProfile(profile);
              if (ctx.mounted) Navigator.pop(ctx);
              _load();
            },
            child: const Text('Save'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      floatingActionButton: FloatingActionButton(
        onPressed: () => _showForm(),
        backgroundColor: AppColors.secondary,
        child: const Icon(Icons.add, color: AppColors.primary),
      ),
      body: _profiles.isEmpty
          ? const _EmptyState(icon: Icons.wifi_outlined, label: 'No APN profiles yet')
          : ListView.separated(
              padding: const EdgeInsets.all(16),
              itemCount: _profiles.length,
              separatorBuilder: (_, __) => const SizedBox(height: 8),
              itemBuilder: (_, i) {
                final a = _profiles[i];
                return _ItemCard(
                  title: a.name,
                  subtitle: a.apn + (a.username.isNotEmpty ? ' · ${a.username}' : ''),
                  icon: Icons.wifi_rounded,
                  onEdit: () => _showForm(existing: a),
                  onDelete: () async {
                    await StorageService.instance.deleteApnProfile(a.id);
                    _load();
                  },
                );
              },
            ),
    );
  }
}

// ─── Shared Widgets ───────────────────────────────────────────────────────────

class _ItemCard extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final bool showIcon;
  final VoidCallback onEdit;
  final VoidCallback onDelete;

  const _ItemCard({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.onEdit,
    required this.onDelete,
    this.showIcon = true,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: EdgeInsets.zero,
      child: ListTile(
        leading: showIcon
            ? Container(
                width: 40,
                height: 40,
                decoration: BoxDecoration(
                  color: AppColors.secondary.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(10),
                ),
                child: Icon(icon, size: 20, color: AppColors.secondary),
              )
            : null,
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(
          subtitle,
          maxLines: 1,
          overflow: TextOverflow.ellipsis,
          style: const TextStyle(fontSize: 12),
        ),
        trailing: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            IconButton(
              icon: const Icon(Icons.edit_outlined, size: 20),
              onPressed: onEdit,
              color: AppColors.secondary,
            ),
            IconButton(
              icon: const Icon(Icons.delete_outline, size: 20),
              onPressed: () async {
                final confirmed = await showDialog<bool>(
                  context: context,
                  builder: (ctx) => AlertDialog(
                    title: const Text('Delete?'),
                    content: Text('Delete "$title"?'),
                    actions: [
                      TextButton(
                          onPressed: () => Navigator.pop(ctx, false),
                          child: const Text('Cancel')),
                      FilledButton(
                          onPressed: () => Navigator.pop(ctx, true),
                          child: const Text('Delete')),
                    ],
                  ),
                );
                if (confirmed == true) onDelete();
              },
              color: AppColors.error,
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final IconData icon;
  final String label;

  const _EmptyState({required this.icon, required this.label});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 56, color: AppColors.grey300),
          const SizedBox(height: 12),
          Text(label, style: const TextStyle(color: AppColors.grey500)),
          const SizedBox(height: 4),
          const Text(
            'Tap + to add one',
            style: TextStyle(color: AppColors.grey400, fontSize: 12),
          ),
        ],
      ),
    );
  }
}
