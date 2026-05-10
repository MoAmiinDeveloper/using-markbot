import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../providers/app_provider.dart';
import '../../services/storage_service.dart';

class SettingsScreen extends StatefulWidget {
  final bool embedded;
  const SettingsScreen({super.key, this.embedded = false});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  final TextEditingController _loginController = TextEditingController();
  final TextEditingController _passwordController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _loginController.text = StorageService.instance.defaultLogin;
    _passwordController.text = StorageService.instance.defaultPassword;
  }

  @override
  void dispose() {
    _loginController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;

    final content = ListView(
      padding: const EdgeInsets.all(AppDimensions.pagePadding),
      children: [
        // App Info
        _SettingsSection(
          title: 'Raadraac Installer',
          isDark: isDark,
          children: [
            _AppInfoCard(isDark: isDark),
          ],
        ).animate().fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.lg),

        // Appearance
        _SettingsSection(
          title: isSomali ? 'Muuqaalka' : 'Appearance',
          isDark: isDark,
          children: [
            _SettingsTile(
              title: isSomali ? 'Habka Mugdiga' : 'Dark Mode',
              subtitle: isSomali ? 'Doorso muuqaalka mugdiga' : 'Switch to dark appearance',
              icon: isDark ? Icons.dark_mode_rounded : Icons.light_mode_rounded,
              isDark: isDark,
              trailing: Switch(
                value: isDark,
                onChanged: (_) => appProvider.toggleDarkMode(),
                activeColor: AppColors.primary,
                activeTrackColor: AppColors.primary.withOpacity(0.3),
              ),
            ),
          ],
        ).animate(delay: 100.ms).fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.lg),

        // Language
        _SettingsSection(
          title: isSomali ? 'Luqadda' : 'Language',
          isDark: isDark,
          children: [
            _LanguageTile(
              currentLang: appProvider.language,
              isDark: isDark,
              onChanged: (lang) => appProvider.setLanguage(lang),
            ),
          ],
        ).animate(delay: 150.ms).fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.lg),

        // SMS Config
        _SettingsSection(
          title: isSomali ? 'Dejinta SMS' : 'SMS Configuration',
          isDark: isDark,
          children: [
            Padding(
              padding: const EdgeInsets.all(AppDimensions.md),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    isSomali ? 'Xogta Gashiga SMS' : 'SMS Credentials',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: AppDimensions.fontMd,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    isSomali
                        ? 'Waxaa loo adeegsadaa qaabka: user pass amarka. Banaan haddaan dejin'
                        : 'Used in format: user pass command. Leave blank if device has no security',
                    style: const TextStyle(
                      color: AppColors.grey500,
                      fontSize: AppDimensions.fontSm,
                    ),
                  ),
                  const SizedBox(height: AppDimensions.sm),
                  TextField(
                    controller: _loginController,
                    decoration: InputDecoration(
                      hintText: isSomali ? 'Magaca Isticmaalaha (banaan)' : 'Username (blank if none)',
                      prefixIcon: const Icon(Icons.person_outline_rounded, size: 18),
                    ),
                    onChanged: (v) => StorageService.instance.setDefaultLogin(v),
                  ),
                  const SizedBox(height: AppDimensions.sm),
                  TextField(
                    controller: _passwordController,
                    decoration: InputDecoration(
                      hintText: isSomali ? 'Furaha (banaan haddaan jirin)' : 'Password (blank if none)',
                      prefixIcon: const Icon(Icons.lock_outline_rounded, size: 18),
                    ),
                    onChanged: (v) => StorageService.instance.setDefaultPassword(v),
                  ),
                ],
              ),
            ),
          ],
        ).animate(delay: 200.ms).fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.lg),

        // About
        _SettingsSection(
          title: isSomali ? 'Ku saabsan' : 'About',
          isDark: isDark,
          children: [
            _SettingsTile(
              title: isSomali ? 'Nooca App-ka' : 'App Version',
              subtitle: '1.0.0',
              icon: Icons.info_outline_rounded,
              isDark: isDark,
            ),
            _SettingsTile(
              title: 'Somtel',
              subtitle: isSomali ? 'Kambaaniyad' : 'Company',
              icon: Icons.business_rounded,
              isDark: isDark,
            ),
            _SettingsTile(
              title: isSomali ? 'Qalabka La Taageero' : 'Supported Devices',
              subtitle: 'FMC130, FMB920, FMC650, FMT100, FMB120',
              icon: Icons.router_rounded,
              isDark: isDark,
            ),
            _SettingsTile(
              title: isSomali ? 'Nooca Android' : 'Android',
              subtitle: 'Android 8.0+ (API 26+)',
              icon: Icons.android_rounded,
              isDark: isDark,
            ),
          ],
        ).animate(delay: 250.ms).fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.xxl),

        // Footer
        Center(
          child: Column(
            children: [
              Container(
                width: 50,
                height: 50,
                decoration: BoxDecoration(
                  color: AppColors.secondary,
                  borderRadius: BorderRadius.circular(14),
                ),
                child: const Icon(Icons.gps_fixed_rounded, color: AppColors.primary, size: 26),
              ),
              const SizedBox(height: AppDimensions.sm),
              const Text(
                'Raadraac Installer',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: AppDimensions.fontLg,
                ),
              ),
              const Text(
                'by Somtel · v1.0.0',
                style: TextStyle(
                  color: AppColors.grey400,
                  fontSize: AppDimensions.fontSm,
                ),
              ),
            ],
          ),
        ).animate(delay: 300.ms).fade(duration: 300.ms),

        const SizedBox(height: AppDimensions.lg),
      ],
    );

    if (widget.embedded) return content;

    return Scaffold(
      appBar: AppBar(
        title: Text(isSomali ? 'Hagaajinta' : 'Settings'),
      ),
      body: content,
    );
  }
}

class _SettingsSection extends StatelessWidget {
  final String title;
  final bool isDark;
  final List<Widget> children;

  const _SettingsSection({
    required this.title,
    required this.isDark,
    required this.children,
  });

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Padding(
          padding: const EdgeInsets.only(left: 4, bottom: AppDimensions.sm),
          child: Text(
            title.toUpperCase(),
            style: const TextStyle(
              color: AppColors.grey500,
              fontSize: AppDimensions.fontXs,
              fontWeight: FontWeight.w700,
              letterSpacing: 1.2,
            ),
          ),
        ),
        Container(
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
            children: children.asMap().entries.map((entry) {
              final isLast = entry.key == children.length - 1;
              return Column(
                children: [
                  entry.value,
                  if (!isLast)
                    Divider(
                      height: 1,
                      indent: AppDimensions.md,
                      endIndent: AppDimensions.md,
                      color: isDark ? AppColors.darkBorder : AppColors.grey100,
                    ),
                ],
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}

class _SettingsTile extends StatelessWidget {
  final String title;
  final String subtitle;
  final IconData icon;
  final bool isDark;
  final Widget? trailing;
  final VoidCallback? onTap;

  const _SettingsTile({
    required this.title,
    required this.subtitle,
    required this.icon,
    required this.isDark,
    this.trailing,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return ListTile(
      onTap: onTap,
      leading: Container(
        width: 36,
        height: 36,
        decoration: BoxDecoration(
          color: AppColors.secondary.withOpacity(0.1),
          borderRadius: BorderRadius.circular(10),
        ),
        child: Icon(icon, size: 18, color: AppColors.secondary),
      ),
      title: Text(
        title,
        style: const TextStyle(fontWeight: FontWeight.w600, fontSize: AppDimensions.fontMd),
      ),
      subtitle: Text(
        subtitle,
        style: const TextStyle(fontSize: AppDimensions.fontSm, color: AppColors.grey500),
      ),
      trailing: trailing,
      contentPadding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.md,
        vertical: AppDimensions.xs,
      ),
    );
  }
}

class _LanguageTile extends StatelessWidget {
  final String currentLang;
  final bool isDark;
  final ValueChanged<String> onChanged;

  const _LanguageTile({
    required this.currentLang,
    required this.isDark,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppDimensions.md),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppColors.secondary.withOpacity(0.1),
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.language_rounded, size: 18, color: AppColors.secondary),
          ),
          const SizedBox(width: AppDimensions.md),
          const Expanded(
            child: Text(
              'Language / Luqadda',
              style: TextStyle(fontWeight: FontWeight.w600, fontSize: AppDimensions.fontMd),
            ),
          ),
          _LangChip(
            label: 'EN',
            isSelected: currentLang == 'en',
            isDark: isDark,
            onTap: () => onChanged('en'),
          ),
          const SizedBox(width: AppDimensions.sm),
          _LangChip(
            label: 'SO',
            isSelected: currentLang == 'so',
            isDark: isDark,
            onTap: () => onChanged('so'),
          ),
        ],
      ),
    );
  }
}

class _LangChip extends StatelessWidget {
  final String label;
  final bool isSelected;
  final bool isDark;
  final VoidCallback onTap;

  const _LangChip({
    required this.label,
    required this.isSelected,
    required this.isDark,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
        decoration: BoxDecoration(
          color: isSelected ? AppColors.secondary : (isDark ? AppColors.darkBackground : AppColors.grey100),
          borderRadius: BorderRadius.circular(AppDimensions.radiusRound),
          border: Border.all(
            color: isSelected ? AppColors.secondary : (isDark ? AppColors.darkBorder : AppColors.grey300),
          ),
        ),
        child: Text(
          label,
          style: TextStyle(
            color: isSelected ? Colors.white : AppColors.grey600,
            fontWeight: isSelected ? FontWeight.w700 : FontWeight.w500,
            fontSize: AppDimensions.fontSm,
          ),
        ),
      ),
    );
  }
}

class _AppInfoCard extends StatelessWidget {
  final bool isDark;
  const _AppInfoCard({required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(AppDimensions.md),
      child: Row(
        children: [
          Container(
            width: 54,
            height: 54,
            decoration: BoxDecoration(
              color: AppColors.secondary,
              borderRadius: BorderRadius.circular(14),
            ),
            child: const Icon(Icons.gps_fixed_rounded, color: AppColors.primary, size: 28),
          ),
          const SizedBox(width: AppDimensions.md),
          const Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Raadraac Installer Tools',
                  style: TextStyle(
                    fontWeight: FontWeight.w700,
                    fontSize: AppDimensions.fontMd,
                  ),
                ),
                Text(
                  'Teltonika GPS Field Toolkit',
                  style: TextStyle(color: AppColors.grey500, fontSize: AppDimensions.fontSm),
                ),
                SizedBox(height: 4),
                Text(
                  'Powered by SOMTEL',
                  style: TextStyle(
                    color: AppColors.primary,
                    fontSize: AppDimensions.fontXs,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.5,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
