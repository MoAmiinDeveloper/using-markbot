import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../models/command_history_model.dart';
import '../../providers/app_provider.dart';
import '../../providers/command_provider.dart';
import 'package:intl/intl.dart';

class HistoryScreen extends StatelessWidget {
  final bool embedded;
  const HistoryScreen({super.key, this.embedded = false});

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final cmdProvider = context.watch<CommandProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;
    final history = cmdProvider.history;

    Widget body = history.isEmpty
        ? _EmptyHistory(isSomali: isSomali)
        : ListView.builder(
            padding: const EdgeInsets.all(AppDimensions.md),
            itemCount: history.length,
            itemBuilder: (context, i) {
              return _HistoryCard(
                item: history[i],
                isSomali: isSomali,
                isDark: isDark,
                onResend: () async {
                  await cmdProvider.resendFromHistory(history[i]);
                  if (context.mounted) {
                    ScaffoldMessenger.of(context).showSnackBar(
                      SnackBar(
                        content: Text(isSomali ? 'SMS si guul ah ayaa loo diray' : 'SMS sent successfully'),
                        backgroundColor: AppColors.success,
                        behavior: SnackBarBehavior.floating,
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                        ),
                      ),
                    );
                  }
                },
                onDelete: () => cmdProvider.deleteHistoryItem(history[i].id),
              ).animate(delay: Duration(milliseconds: 30 * i)).fade(duration: 300.ms);
            },
          );

    if (embedded) {
      return Column(
        children: [
          if (history.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(
                AppDimensions.md,
                AppDimensions.md,
                AppDimensions.md,
                0,
              ),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    isSomali ? 'Taariikhda Amarrada' : 'Command History',
                    style: Theme.of(context).textTheme.titleSmall?.copyWith(
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  TextButton(
                    onPressed: () => _confirmClear(context, cmdProvider, isSomali),
                    child: Text(
                      isSomali ? 'Nadiifi' : 'Clear All',
                      style: const TextStyle(color: AppColors.error, fontSize: AppDimensions.fontSm),
                    ),
                  ),
                ],
              ),
            ),
          Expanded(child: body),
        ],
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(isSomali ? 'Taariikhda Amarrada' : 'Command History'),
        actions: [
          if (history.isNotEmpty)
            TextButton(
              onPressed: () => _confirmClear(context, cmdProvider, isSomali),
              child: const Text('Clear', style: TextStyle(color: AppColors.error)),
            ),
        ],
      ),
      body: body,
    );
  }

  void _confirmClear(BuildContext context, CommandProvider provider, bool isSomali) {
    showDialog(
      context: context,
      builder: (ctx) => AlertDialog(
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
        ),
        title: Text(isSomali ? 'Nadiifi Taariikhda' : 'Clear History'),
        content: Text(
          isSomali
              ? 'Miyaad hubtaa inaad taariikhda oo dhan tirso?'
              : 'Are you sure you want to clear all history?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx),
            child: Text(isSomali ? 'Baaji' : 'Cancel'),
          ),
          ElevatedButton(
            onPressed: () {
              provider.clearHistory();
              Navigator.pop(ctx);
            },
            style: ElevatedButton.styleFrom(
              backgroundColor: AppColors.error,
              foregroundColor: Colors.white,
            ),
            child: Text(isSomali ? 'Nadiifi' : 'Clear'),
          ),
        ],
      ),
    );
  }
}

class _HistoryCard extends StatelessWidget {
  final CommandHistoryModel item;
  final bool isSomali;
  final bool isDark;
  final VoidCallback onResend;
  final VoidCallback onDelete;

  const _HistoryCard({
    required this.item,
    required this.isSomali,
    required this.isDark,
    required this.onResend,
    required this.onDelete,
  });

  @override
  Widget build(BuildContext context) {
    final dateStr = DateFormat('MMM d, HH:mm').format(item.timestamp);

    return Dismissible(
      key: Key(item.id),
      direction: DismissDirection.endToStart,
      background: Container(
        alignment: Alignment.centerRight,
        padding: const EdgeInsets.only(right: AppDimensions.md),
        decoration: BoxDecoration(
          color: AppColors.error,
          borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
        ),
        child: const Icon(Icons.delete_rounded, color: Colors.white),
      ),
      onDismissed: (_) => onDelete(),
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
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        item.commandName,
                        style: const TextStyle(
                          fontWeight: FontWeight.w700,
                          fontSize: AppDimensions.fontMd,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        '${item.deviceModel} · ${item.trackerNumber}',
                        style: const TextStyle(
                          fontSize: AppDimensions.fontSm,
                          color: AppColors.grey500,
                        ),
                      ),
                    ],
                  ),
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                      decoration: BoxDecoration(
                        color: item.sent
                            ? AppColors.success.withOpacity(0.12)
                            : AppColors.warning.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(20),
                      ),
                      child: Text(
                        item.sent
                            ? (isSomali ? 'La diray' : 'Sent')
                            : (isSomali ? 'La sameyay' : 'Generated'),
                        style: TextStyle(
                          fontSize: AppDimensions.fontXs,
                          color: item.sent ? AppColors.success : AppColors.warning,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      dateStr,
                      style: const TextStyle(
                        fontSize: AppDimensions.fontXs,
                        color: AppColors.grey400,
                      ),
                    ),
                  ],
                ),
              ],
            ),

            const SizedBox(height: AppDimensions.sm),
            const Divider(height: 1),
            const SizedBox(height: AppDimensions.sm),

            // SMS Text
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(AppDimensions.sm),
              decoration: BoxDecoration(
                color: isDark ? AppColors.darkBackground : AppColors.grey100,
                borderRadius: BorderRadius.circular(AppDimensions.radiusSm),
              ),
              child: Text(
                item.generatedSms,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: AppDimensions.fontSm,
                  fontWeight: FontWeight.w600,
                  color: AppColors.secondary,
                ),
              ),
            ),

            const SizedBox(height: AppDimensions.sm),

            // Actions
            Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                OutlinedButton.icon(
                  onPressed: onResend,
                  icon: const Icon(Icons.send_rounded, size: 16),
                  label: Text(
                    isSomali ? 'Dir' : 'Resend',
                    style: const TextStyle(fontSize: AppDimensions.fontSm),
                  ),
                  style: OutlinedButton.styleFrom(
                    foregroundColor: AppColors.secondary,
                    side: const BorderSide(color: AppColors.secondary),
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                    minimumSize: Size.zero,
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                    ),
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyHistory extends StatelessWidget {
  final bool isSomali;
  const _EmptyHistory({required this.isSomali});

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.history_rounded, size: 72, color: AppColors.grey300),
          const SizedBox(height: AppDimensions.md),
          Text(
            isSomali ? 'Taariikhda ama jirto' : 'No command history yet',
            style: const TextStyle(
              color: AppColors.grey500,
              fontSize: AppDimensions.fontLg,
              fontWeight: FontWeight.w500,
            ),
          ),
          const SizedBox(height: AppDimensions.sm),
          Text(
            isSomali
                ? 'SMS-yadashu halkan ayay muqaan doontaan'
                : 'Your sent SMS commands will appear here',
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
