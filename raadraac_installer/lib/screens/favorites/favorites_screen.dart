import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../data/commands_data.dart';
import '../../providers/app_provider.dart';
import '../../providers/command_provider.dart';
import '../command_form/command_form_screen.dart';

class FavoritesScreen extends StatelessWidget {
  final bool embedded;
  const FavoritesScreen({super.key, this.embedded = false});

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final cmdProvider = context.watch<CommandProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;
    final favorites = cmdProvider.favorites;

    Widget body = favorites.isEmpty
        ? _EmptyFavorites(isSomali: isSomali)
        : ListView.builder(
            padding: const EdgeInsets.all(AppDimensions.md),
            itemCount: favorites.length,
            itemBuilder: (context, i) {
              final fav = favorites[i];
              final command = CommandsData.getById(fav.commandId);
              if (command == null) return const SizedBox.shrink();

              return _FavoriteCard(
                commandName: isSomali ? command.nameSo : command.name,
                commandDesc: isSomali ? command.descriptionSo : command.description,
                category: fav.category,
                isDark: isDark,
                onTap: () {
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => CommandFormScreen(command: command),
                    ),
                  );
                },
                onRemove: () => cmdProvider.toggleFavorite(
                  fav.commandId,
                  fav.commandName,
                  fav.category,
                ),
              ).animate(delay: Duration(milliseconds: 40 * i)).fade(duration: 300.ms);
            },
          );

    if (embedded) {
      return Column(
        children: [
          if (favorites.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppDimensions.md,
                AppDimensions.md,
                AppDimensions.md,
                0,
              ),
              child: Align(
                alignment: Alignment.centerLeft,
                child: Text(
                  isSomali ? 'Amarrada La Doortay' : 'Favorite Commands',
                  style: Theme.of(context).textTheme.titleSmall?.copyWith(
                        fontWeight: FontWeight.w700,
                      ),
                ),
              ),
            ),
          Expanded(child: body),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(isSomali ? 'La Doortay' : 'Favorites'),
      ),
      body: body,
    );
  }
}

class _FavoriteCard extends StatelessWidget {
  final String commandName;
  final String commandDesc;
  final String category;
  final bool isDark;
  final VoidCallback onTap;
  final VoidCallback onRemove;

  const _FavoriteCard({
    required this.commandName,
    required this.commandDesc,
    required this.category,
    required this.isDark,
    required this.onTap,
    required this.onRemove,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppDimensions.md),
        padding: const EdgeInsets.all(AppDimensions.md),
        decoration: BoxDecoration(
          color: isDark ? AppColors.darkCard : Colors.white,
          borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
          border: Border.all(
            color: isDark ? AppColors.darkBorder : AppColors.grey200,
          ),
          boxShadow: [
            BoxShadow(
              color: AppColors.shadowLight,
              blurRadius: 8,
              offset: const Offset(0, 2),
            ),
          ],
        ),
        child: Row(
          children: [
            Container(
              width: 44,
              height: 44,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.12),
                borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
              ),
              child: const Icon(
                Icons.star_rounded,
                color: AppColors.primary,
                size: 22,
              ),
            ),
            const SizedBox(width: AppDimensions.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    commandName,
                    style: const TextStyle(
                      fontWeight: FontWeight.w700,
                      fontSize: AppDimensions.fontMd,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    commandDesc,
                    style: const TextStyle(
                      fontSize: AppDimensions.fontSm,
                      color: AppColors.grey500,
                    ),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                  const SizedBox(height: 4),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                    decoration: BoxDecoration(
                      color: AppColors.secondary.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(20),
                    ),
                    child: Text(
                      category,
                      style: const TextStyle(
                        fontSize: AppDimensions.fontXs,
                        color: AppColors.secondary,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
            ),
            Column(
              children: [
                const Icon(Icons.chevron_right_rounded, color: AppColors.grey400),
                const SizedBox(height: 4),
                GestureDetector(
                  onTap: onRemove,
                  child: const Icon(Icons.star_rounded, color: AppColors.primary, size: 20),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyFavorites extends StatelessWidget {
  final bool isSomali;
  const _EmptyFavorites({required this.isSomali});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          const Icon(Icons.star_outline_rounded, size: 72, color: AppColors.grey300),
          const SizedBox(height: AppDimensions.md),
          Text(
            isSomali ? 'Amar la dooran ma jirto' : 'No favorites added yet',
            style: const TextStyle(
              color: AppColors.grey500,
              fontSize: AppDimensions.fontLg,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: AppDimensions.sm),
          Text(
            isSomali
                ? 'Taabo ⭐ si aad amarka ku darto'
                : 'Tap ⭐ on any command to save it here',
            style: const TextStyle(
              color: AppColors.grey400,
              fontSize: AppDimensions.fontSm,
            ),
          ),
        ],
      ),
    );
  }
}
