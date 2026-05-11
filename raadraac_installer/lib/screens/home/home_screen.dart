import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../data/device_models_data.dart';
import '../../providers/app_provider.dart';
import '../../providers/command_provider.dart';
import '../../services/sms_service.dart';
import '../commands/commands_screen.dart';
import '../history/history_screen.dart';
import '../favorites/favorites_screen.dart';
import '../settings/settings_screen.dart';
import '../../widgets/common/app_button.dart';
import '../../widgets/common/app_text_field.dart';

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  int _selectedIndex = 0;
  final TextEditingController _trackerController = TextEditingController();
  String? _trackerError;
  String? _deviceError;

  final List<Widget> _pages = [];

  @override
  void initState() {
    super.initState();
    _requestPermissions();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      final appProvider = context.read<AppProvider>();
      if (appProvider.trackerNumber.isNotEmpty) {
        _trackerController.text = appProvider.trackerNumber;
      }
    });
  }

  Future<void> _requestPermissions() async {
    await SmsService.instance.requestPermissions();
  }

  @override
  void dispose() {
    _trackerController.dispose();
    super.dispose();
  }

  bool _validate() {
    final appProvider = context.read<AppProvider>();
    bool valid = true;

    if (_trackerController.text.trim().isEmpty) {
      setState(() => _trackerError = 'Please enter tracker SIM number');
      valid = false;
    } else if (!SmsService.instance.isValidPhoneNumber(_trackerController.text.trim())) {
      setState(() => _trackerError = 'Invalid phone number');
      valid = false;
    } else {
      setState(() => _trackerError = null);
      appProvider.setTrackerNumber(_trackerController.text.trim());
    }

    if (appProvider.selectedDevice.isEmpty) {
      setState(() => _deviceError = 'Please select a device model');
      valid = false;
    } else {
      setState(() => _deviceError = null);
    }

    return valid;
  }

  void _continue() async {
    if (!_validate()) return;
    final appProvider = context.read<AppProvider>();
    await appProvider.saveSession();

    final commandProvider = context.read<CommandProvider>();
    commandProvider.filterByDevice(appProvider.selectedDevice);

    Navigator.of(context).push(
      PageRouteBuilder(
        pageBuilder: (_, a, __) => const CommandsScreen(),
        transitionsBuilder: (_, anim, __, child) {
          return SlideTransition(
            position: Tween<Offset>(
              begin: const Offset(1.0, 0.0),
              end: Offset.zero,
            ).animate(CurvedAnimation(parent: anim, curve: Curves.easeOutCubic)),
            child: child,
          );
        },
        transitionDuration: const Duration(milliseconds: 350),
      ),
    );
  }

  Widget _buildSetupTab() {
    final appProvider = context.watch<AppProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(AppDimensions.pagePadding),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Header Banner
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(AppDimensions.lg),
            decoration: BoxDecoration(
              gradient: AppColors.primaryGradient,
              borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
              boxShadow: [
                BoxShadow(
                  color: AppColors.secondary.withOpacity(0.3),
                  blurRadius: 20,
                  offset: const Offset(0, 8),
                ),
              ],
            ),
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: BoxDecoration(
                    color: Colors.white.withOpacity(0.15),
                    borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                  ),
                  child: const Icon(
                    Icons.gps_fixed_rounded,
                    color: AppColors.primary,
                    size: 30,
                  ),
                ),
                const SizedBox(width: AppDimensions.md),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isSomali ? 'Xalinta Teltonika' : 'Teltonika Device Setup',
                        style: const TextStyle(
                          color: Colors.white,
                          fontSize: AppDimensions.fontLg,
                          fontWeight: FontWeight.w700,
                        ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        isSomali
                            ? 'Geli lambarka SIM iyo nooca qalabka'
                            : 'Enter SIM number and device model to begin',
                        style: const TextStyle(
                          color: Colors.white70,
                          fontSize: AppDimensions.fontSm,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ).animate().slideY(begin: 0.2, end: 0, duration: 400.ms).fade(),

          const SizedBox(height: AppDimensions.xl),

          // Tracker Number
          Text(
            isSomali ? 'Lambarka Tracker-ka' : 'Tracker SIM Number',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ).animate(delay: 100.ms).fade(),
          const SizedBox(height: AppDimensions.sm),
          AppTextField(
            controller: _trackerController,
            hint: isSomali ? 'Geli lambarka telefoonka SIM' : 'Enter SIM phone number',
            prefixIcon: Icons.sim_card_outlined,
            keyboardType: TextInputType.phone,
            errorText: _trackerError,
            onChanged: (v) {
              context.read<AppProvider>().setTrackerNumber(v);
              if (_trackerError != null) setState(() => _trackerError = null);
            },
          ).animate(delay: 150.ms).slideX(begin: -0.1, end: 0).fade(),

          // SIM Picker (only shown when multiple SIMs detected)
          if (appProvider.simCards.length > 1) ...[
            const SizedBox(height: AppDimensions.lg),
            Text(
              isSomali ? 'Dooro SIM-ka Dirista' : 'Send via SIM',
              style: Theme.of(context).textTheme.titleSmall?.copyWith(
                    fontWeight: FontWeight.w700,
                  ),
            ).animate(delay: 175.ms).fade(),
            const SizedBox(height: AppDimensions.sm),
            Row(
              children: appProvider.simCards.map((sim) {
                final isSelected = sim.subscriptionId == appProvider.selectedSimSubscriptionId;
                return Expanded(
                  child: Padding(
                    padding: EdgeInsets.only(
                      right: sim == appProvider.simCards.last ? 0 : 8,
                    ),
                    child: GestureDetector(
                      onTap: () => context.read<AppProvider>().selectSim(sim.subscriptionId),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        padding: const EdgeInsets.symmetric(vertical: 12, horizontal: 8),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? AppColors.secondary
                              : (isDark ? AppColors.darkCard : Colors.white),
                          borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                          border: Border.all(
                            color: isSelected
                                ? AppColors.secondary
                                : (isDark ? AppColors.darkBorder : AppColors.grey300),
                            width: isSelected ? 2 : 1,
                          ),
                        ),
                        child: Column(
                          children: [
                            Icon(
                              Icons.sim_card_rounded,
                              size: 20,
                              color: isSelected ? AppColors.primary : AppColors.grey500,
                            ),
                            const SizedBox(height: 4),
                            Text(
                              sim.displayName,
                              textAlign: TextAlign.center,
                              style: TextStyle(
                                fontSize: AppDimensions.fontSm,
                                fontWeight: FontWeight.w600,
                                color: isSelected ? AppColors.primary : null,
                              ),
                            ),
                            if (sim.number.isNotEmpty)
                              Text(
                                sim.number,
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: AppDimensions.fontXs,
                                  color: isSelected
                                      ? AppColors.primary.withOpacity(0.8)
                                      : AppColors.grey500,
                                ),
                              ),
                          ],
                        ),
                      ),
                    ),
                  ),
                );
              }).toList(),
            ).animate(delay: 175.ms).slideX(begin: -0.1, end: 0).fade(),
          ],

          const SizedBox(height: AppDimensions.lg),

          // Device Model
          Text(
            isSomali ? 'Nooca Qalabka' : 'Device Model',
            style: Theme.of(context).textTheme.titleSmall?.copyWith(
                  fontWeight: FontWeight.w700,
                ),
          ).animate(delay: 200.ms).fade(),
          const SizedBox(height: AppDimensions.sm),

          _DeviceDropdown(
            selectedValue: appProvider.selectedDevice.isEmpty
                ? null
                : appProvider.selectedDevice,
            errorText: _deviceError,
            isSomali: isSomali,
            isDark: isDark,
            onChanged: (val) {
              context.read<AppProvider>().setSelectedDevice(val ?? '');
              if (_deviceError != null) setState(() => _deviceError = null);
            },
          ).animate(delay: 250.ms).slideX(begin: -0.1, end: 0).fade(),

          const SizedBox(height: AppDimensions.xl),

          // Continue Button
          AppPrimaryButton(
            label: isSomali ? 'Sii wad' : 'Continue',
            icon: Icons.arrow_forward_rounded,
            onPressed: _continue,
          ).animate(delay: 350.ms).slideY(begin: 0.2, end: 0).fade(),

          const SizedBox(height: AppDimensions.xl),

          // Recent Sessions
          _RecentSessionsSection(isSomali: isSomali, onTap: _loadSession),
        ],
      ),
    );
  }

  void _loadSession(Map<String, String> session) {
    final number = session['trackerNumber'] ?? '';
    final model = session['deviceModel'] ?? '';
    _trackerController.text = number;
    context.read<AppProvider>().setTrackerNumber(number);
    context.read<AppProvider>().setSelectedDevice(model);
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;

    final tabs = [
      _buildSetupTab(),
      const HistoryScreen(embedded: true),
      const FavoritesScreen(embedded: true),
      const SettingsScreen(embedded: true),
    ];

    return Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        title: Row(
          children: [
            Container(
              width: 34,
              height: 34,
              decoration: BoxDecoration(
                color: AppColors.primary.withOpacity(0.2),
                borderRadius: BorderRadius.circular(8),
              ),
              child: const Icon(Icons.gps_fixed_rounded, size: 20, color: AppColors.primary),
            ),
            const SizedBox(width: 10),
            const Text('Raadraac Installer'),
          ],
        ),
        actions: [
          Container(
            margin: const EdgeInsets.only(right: 12),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: AppColors.primary.withOpacity(0.15),
              borderRadius: BorderRadius.circular(20),
            ),
            child: const Text(
              'SOMTEL',
              style: TextStyle(
                color: AppColors.primary,
                fontSize: 11,
                fontWeight: FontWeight.w800,
                letterSpacing: 1.5,
              ),
            ),
          ),
        ],
      ),
      body: IndexedStack(
        index: _selectedIndex,
        children: tabs,
      ),
      bottomNavigationBar: Container(
        decoration: BoxDecoration(
          boxShadow: [
            BoxShadow(
              color: isDark
                  ? Colors.black.withOpacity(0.3)
                  : Colors.black.withOpacity(0.08),
              blurRadius: 20,
              offset: const Offset(0, -4),
            ),
          ],
        ),
        child: BottomNavigationBar(
          currentIndex: _selectedIndex,
          onTap: (i) => setState(() => _selectedIndex = i),
          items: [
            BottomNavigationBarItem(
              icon: const Icon(Icons.home_outlined),
              activeIcon: const Icon(Icons.home_rounded),
              label: isSomali ? 'Guriga' : 'Home',
            ),
            BottomNavigationBarItem(
              icon: const Icon(Icons.history_outlined),
              activeIcon: const Icon(Icons.history_rounded),
              label: isSomali ? 'Taariikhda' : 'History',
            ),
            BottomNavigationBarItem(
              icon: const Icon(Icons.star_outline_rounded),
              activeIcon: const Icon(Icons.star_rounded),
              label: isSomali ? 'La doortay' : 'Favorites',
            ),
            BottomNavigationBarItem(
              icon: const Icon(Icons.settings_outlined),
              activeIcon: const Icon(Icons.settings_rounded),
              label: isSomali ? 'Hagaajinta' : 'Settings',
            ),
          ],
        ),
      ),
    );
  }
}

class _DeviceDropdown extends StatelessWidget {
  final String? selectedValue;
  final String? errorText;
  final bool isSomali;
  final bool isDark;
  final ValueChanged<String?> onChanged;

  const _DeviceDropdown({
    this.selectedValue,
    this.errorText,
    required this.isSomali,
    required this.isDark,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final fillColor = isDark ? AppColors.darkCard : AppColors.grey100;
    final borderColor = errorText != null
        ? AppColors.error
        : isDark
            ? AppColors.darkBorder
            : AppColors.grey300;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: AppDimensions.md),
          decoration: BoxDecoration(
            color: fillColor,
            borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
            border: Border.all(color: borderColor, width: errorText != null ? 1.5 : 1),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: selectedValue,
              hint: Text(
                isSomali ? 'Dooro Nooca Qalabka' : 'Select Device Model',
                style: TextStyle(color: AppColors.grey500, fontSize: AppDimensions.fontMd),
              ),
              isExpanded: true,
              icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppColors.grey500),
              dropdownColor: isDark ? AppColors.darkCard : Colors.white,
              borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
              items: DeviceModelsData.devices.map((device) {
                return DropdownMenuItem<String>(
                  value: device.id,
                  child: Row(
                    children: [
                      Container(
                        width: 36,
                        height: 36,
                        decoration: BoxDecoration(
                          color: AppColors.secondary.withOpacity(0.1),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: const Icon(
                          Icons.router_outlined,
                          size: 18,
                          color: AppColors.secondary,
                        ),
                      ),
                      const SizedBox(width: AppDimensions.sm),
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        mainAxisAlignment: MainAxisAlignment.center,
                        children: [
                          Text(
                            device.name,
                            style: const TextStyle(
                              fontWeight: FontWeight.w600,
                              fontSize: AppDimensions.fontMd,
                            ),
                          ),
                          Text(
                            device.description,
                            style: const TextStyle(
                              fontSize: AppDimensions.fontXs,
                              color: AppColors.grey500,
                            ),
                            overflow: TextOverflow.ellipsis,
                          ),
                        ],
                      ),
                    ],
                  ),
                );
              }).toList(),
              onChanged: onChanged,
            ),
          ),
        ),
        if (errorText != null) ...[
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 12),
            child: Text(
              errorText!,
              style: const TextStyle(color: AppColors.error, fontSize: AppDimensions.fontSm),
            ),
          ),
        ],
      ],
    );
  }
}

class _RecentSessionsSection extends StatelessWidget {
  final bool isSomali;
  final Function(Map<String, String>) onTap;

  const _RecentSessionsSection({required this.isSomali, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final sessions = context.watch<AppProvider>().getRecentSessions();
    if (sessions.isEmpty) return const SizedBox.shrink();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          isSomali ? 'Xidhiidhyada dhawaan' : 'Recent Sessions',
          style: Theme.of(context).textTheme.titleSmall?.copyWith(
                fontWeight: FontWeight.w700,
              ),
        ).animate(delay: 400.ms).fade(),
        const SizedBox(height: AppDimensions.sm),
        ...sessions.take(5).map((session) {
          return _SessionTile(session: session, onTap: () => onTap(session));
        }),
      ],
    );
  }
}

class _SessionTile extends StatelessWidget {
  final Map<String, String> session;
  final VoidCallback onTap;

  const _SessionTile({required this.session, required this.onTap});

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;

    return GestureDetector(
      onTap: onTap,
      child: Container(
        margin: const EdgeInsets.only(bottom: AppDimensions.sm),
        padding: const EdgeInsets.all(AppDimensions.md),
        decoration: BoxDecoration(
          color: isDark ? AppColors.darkCard : Colors.white,
          borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
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
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: AppColors.secondary.withOpacity(0.1),
                borderRadius: BorderRadius.circular(10),
              ),
              child: const Icon(
                Icons.history_rounded,
                size: 20,
                color: AppColors.secondary,
              ),
            ),
            const SizedBox(width: AppDimensions.md),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    session['trackerNumber'] ?? '',
                    style: const TextStyle(
                      fontWeight: FontWeight.w600,
                      fontSize: AppDimensions.fontMd,
                    ),
                  ),
                  Text(
                    session['deviceModel'] ?? '',
                    style: const TextStyle(
                      fontSize: AppDimensions.fontSm,
                      color: AppColors.grey500,
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded, color: AppColors.grey400),
          ],
        ),
      ).animate().fade(),
    );
  }
}
