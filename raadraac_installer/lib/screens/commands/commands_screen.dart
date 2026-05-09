import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../models/command_model.dart';
import '../../providers/app_provider.dart';
import '../../providers/command_provider.dart';
import '../command_form/command_form_screen.dart';
import '../../widgets/command_card.dart';

class CommandsScreen extends StatefulWidget {
  const CommandsScreen({super.key});

  @override
  State<CommandsScreen> createState() => _CommandsScreenState();
}

class _CommandsScreenState extends State<CommandsScreen> {
  final TextEditingController _searchController = TextEditingController();

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Color _categoryColor(CommandCategory cat) {
    switch (cat) {
      case CommandCategory.system:
        return AppColors.categorySystem;
      case CommandCategory.network:
        return AppColors.categoryNetwork;
      case CommandCategory.tracking:
        return AppColors.categoryTracking;
      case CommandCategory.outputs:
        return AppColors.categoryOutputs;
      case CommandCategory.bluetooth:
        return AppColors.categoryBluetooth;
    }
  }

  IconData _categoryIcon(CommandCategory cat) {
    switch (cat) {
      case CommandCategory.system:
        return Icons.settings_rounded;
      case CommandCategory.network:
        return Icons.cell_tower_rounded;
      case CommandCategory.tracking:
        return Icons.gps_fixed_rounded;
      case CommandCategory.outputs:
        return Icons.electrical_services_rounded;
      case CommandCategory.bluetooth:
        return Icons.bluetooth_rounded;
    }
  }

  void _openCommand(BuildContext context, CommandModel command) {
    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (_, a, __) => CommandFormScreen(command: command),
        transitionsBuilder: (_, anim, __, child) {
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(1.0, 0.0),
              end: Offset.zero,
            ).animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
            child: child,
          );
        },
        transitionDuration: const Duration(milliseconds: 300),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final cmdProvider = context.watch<CommandProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;

    final grouped = cmdProvider.getGroupedCommands();
    final categories = [null, ...CommandCategory.values];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(isSomali ? 'Amarrada' : 'Commands'),
            Text(
              appProvider.selectedDevice,
              style: const TextStyle(
                fontSize: AppDimensions.fontSm,
                color: AppColors.primary,
                fontWeight: FontWeight.w500,
              ),
            ),
          ],
        ),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(56),
          child: Padding(
            padding: const EdgeInsets.fromLTRB(
              AppDimensions.md, 0, AppDimensions.md, AppDimensions.sm,
            ),
            child: _SearchBar(
              controller: _searchController,
              isSomali: isSomali,
              isDark: isDark,
              onChanged: (q) => cmdProvider.search(q),
            ),
          ),
        ),
      ),
      body: Column(
        children: [
          // Category Filter Chips
          SizedBox(
            height: 50,
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(
                horizontal: AppDimensions.md,
                vertical: AppDimensions.sm,
              ),
              scrollDirection: Axis.horizontal,
              itemCount: categories.length,
              itemBuilder: (context, i) {
                final cat = categories[i];
                final isSelected = cmdProvider.selectedCategory == cat;

                return Padding(
                  padding: const EdgeInsets.only(right: AppDimensions.sm),
                  child: GestureDetector(
                    onTap: () => cmdProvider.setCategory(cat),
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 200),
                      padding: const EdgeInsets.symmetric(
                        horizontal: AppDimensions.md,
                        vertical: 6,
                      ),
                      decoration: BoxDecoration(
                        color: isSelected
                            ? (cat == null ? AppColors.secondary : _categoryColor(cat))
                            : (isDark ? AppColors.darkCard : AppColors.grey100),
                        borderRadius: BorderRadius.circular(AppDimensions.radiusRound),
                        border: Border.all(
                          color: isSelected
                              ? Colors.transparent
                              : (isDark ? AppColors.darkBorder : AppColors.grey300),
                        ),
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          if (cat != null) ...[
                            Icon(
                              _categoryIcon(cat),
                              size: 14,
                              color: isSelected ? Colors.white : AppColors.grey600,
                            ),
                            const SizedBox(width: 4),
                          ],
                          Text(
                            cat == null
                                ? (isSomali ? 'Dhammaan' : 'All')
                                : (isSomali ? cat.nameSo : cat.name),
                            style: TextStyle(
                              color: isSelected ? Colors.white : AppColors.grey600,
                              fontSize: AppDimensions.fontSm,
                              fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                );
              },
            ),
          ),

          // Commands List
          Expanded(
            child: grouped.isEmpty
                ? _EmptyState(isSomali: isSomali)
                : ListView.builder(
                    padding: const EdgeInsets.all(AppDimensions.md),
                    itemCount: grouped.length,
                    itemBuilder: (context, catIndex) {
                      final category = grouped.keys.elementAt(catIndex);
                      final cmds = grouped[category]!;

                      return Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Category Header
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              vertical: AppDimensions.sm,
                            ),
                            child: Row(
                              children: [
                                Container(
                                  width: 30,
                                  height: 30,
                                  decoration: BoxDecoration(
                                    color: _categoryColor(category).withOpacity(0.15),
                                    borderRadius: BorderRadius.circular(8),
                                  ),
                                  child: Icon(
                                    _categoryIcon(category),
                                    size: 16,
                                    color: _categoryColor(category),
                                  ),
                                ),
                                const SizedBox(width: AppDimensions.sm),
                                Text(
                                  isSomali ? category.nameSo : category.name,
                                  style: TextStyle(
                                    fontWeight: FontWeight.w700,
                                    fontSize: AppDimensions.fontMd,
                                    color: _categoryColor(category),
                                  ),
                                ),
                                const SizedBox(width: AppDimensions.sm),
                                Container(
                                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                                  decoration: BoxDecoration(
                                    color: _categoryColor(category).withOpacity(0.12),
                                    borderRadius: BorderRadius.circular(20),
                                  ),
                                  child: Text(
                                    '${cmds.length}',
                                    style: TextStyle(
                                      fontSize: AppDimensions.fontXs,
                                      color: _categoryColor(category),
                                      fontWeight: FontWeight.w700,
                                    ),
                                  ),
                                ),
                              ],
                            ),
                          ),

                          // Commands
                          ...cmds.asMap().entries.map((entry) {
                            final idx = entry.key;
                            final cmd = entry.value;
                            return CommandCard(
                              command: cmd,
                              isSomali: isSomali,
                              isDark: isDark,
                              categoryColor: _categoryColor(category),
                              categoryIcon: _categoryIcon(category),
                              isFavorite: cmdProvider.isFavorite(cmd.id),
                              onTap: () => _openCommand(context, cmd),
                              onFavoriteToggle: () => cmdProvider.toggleFavorite(
                                cmd.id,
                                isSomali ? cmd.nameSo : cmd.name,
                                isSomali ? category.nameSo : category.name,
                              ),
                            ).animate(delay: Duration(milliseconds: 40 * idx)).slideX(
                                  begin: 0.05,
                                  end: 0,
                                  duration: 300.ms,
                                  curve: Curves.easeOutCubic,
                                ).fade(duration: 300.ms);
                          }),

                          const SizedBox(height: AppDimensions.sm),
                        ],
                      );
                    },
                  ),
          ),
        ],
      ),
    );
  }
}

class _SearchBar extends StatelessWidget {
  final TextEditingController controller;
  final bool isSomali;
  final bool isDark;
  final ValueChanged<String> onChanged;

  const _SearchBar({
    required this.controller,
    required this.isSomali,
    required this.isDark,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      height: 42,
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkCard : Colors.white,
        borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
        border: Border.all(
          color: isDark ? AppColors.darkBorder : AppColors.grey200,
        ),
      ),
      child: TextField(
        controller: controller,
        onChanged: onChanged,
        style: TextStyle(
          color: isDark ? AppColors.darkText : AppColors.grey900,
          fontSize: AppDimensions.fontMd,
        ),
        decoration: InputDecoration(
          hintText: isSomali ? 'Raadi amarrada...' : 'Search commands...',
          hintStyle: const TextStyle(color: AppColors.grey400, fontSize: AppDimensions.fontMd),
          prefixIcon: const Icon(Icons.search_rounded, size: 20, color: AppColors.grey400),
          suffixIcon: controller.text.isNotEmpty
              ? GestureDetector(
                  onTap: () {
                    controller.clear();
                    onChanged('');
                  },
                  child: const Icon(Icons.clear_rounded, size: 18, color: AppColors.grey400),
                )
              : null,
          border: InputBorder.none,
          enabledBorder: InputBorder.none,
          focusedBorder: InputBorder.none,
          contentPadding: const EdgeInsets.symmetric(vertical: 10),
          filled: false,
        ),
      ),
    );
  }
}

class _EmptyState extends StatelessWidget {
  final bool isSomali;
  const _EmptyState({required this.isSomali});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            Icons.search_off_rounded,
            size: 64,
            color: AppColors.grey300,
          ),
          const SizedBox(height: AppDimensions.md),
          Text(
            isSomali ? 'Amar lama helin' : 'No commands found',
            style: const TextStyle(
              color: AppColors.grey500,
              fontSize: AppDimensions.fontLg,
              fontWeight: FontWeight.w500,
            ),
          ),
        ],
      ),
    );
  }
}
