import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_animate/flutter_animate.dart';
import 'package:provider/provider.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../data/commands_data.dart';
import '../../models/command_model.dart';
import '../../models/command_field_model.dart';
import '../../providers/app_provider.dart';
import '../../providers/command_provider.dart';
import '../../services/sms_service.dart';
import '../../widgets/common/app_button.dart';
import '../../widgets/common/app_text_field.dart';

class CommandFormScreen extends StatefulWidget {
  final CommandModel command;

  const CommandFormScreen({super.key, required this.command});

  @override
  State<CommandFormScreen> createState() => _CommandFormScreenState();
}

class _CommandFormScreenState extends State<CommandFormScreen> {
  final Map<String, TextEditingController> _controllers = {};
  final Map<String, String> _dropdownValues = {};
  final Map<String, String?> _errors = {};
  String? _selectedPreset;
  bool _showPreview = false;
  bool _isDangerous = false;

  @override
  void initState() {
    super.initState();
    _isDangerous = widget.command.isDangerous;
    for (final field in widget.command.fields) {
      if (field.type == FieldType.dropdown) {
        _dropdownValues[field.key] = field.defaultValue ?? field.options?.first;
      } else {
        _controllers[field.key] = TextEditingController(text: field.defaultValue ?? '');
      }
    }
  }

  @override
  void dispose() {
    for (final ctrl in _controllers.values) {
      ctrl.dispose();
    }
    super.dispose();
  }

  Map<String, String> _collectValues() {
    final Map<String, String> values = {};
    for (final field in widget.command.fields) {
      if (field.type == FieldType.dropdown) {
        values[field.key] = _dropdownValues[field.key] ?? field.defaultValue ?? '';
      } else {
        values[field.key] = _controllers[field.key]?.text ?? '';
      }
    }
    return values;
  }

  bool _validate() {
    bool valid = true;
    final newErrors = <String, String?>{};

    for (final field in widget.command.fields) {
      if (!field.required) continue;

      final value = field.type == FieldType.dropdown
          ? _dropdownValues[field.key] ?? ''
          : _controllers[field.key]?.text ?? '';

      if (value.trim().isEmpty) {
        newErrors[field.key] = 'This field is required';
        valid = false;
      } else if (field.validationPattern != null) {
        final regex = RegExp(field.validationPattern!);
        if (!regex.hasMatch(value.trim())) {
          newErrors[field.key] = 'Invalid format';
          valid = false;
        }
      }
    }

    setState(() {
      _errors.clear();
      _errors.addAll(newErrors);
    });

    return valid;
  }

  void _generateSms() {
    if (!_validate()) return;

    final appProvider = context.read<AppProvider>();
    final cmdProvider = context.read<CommandProvider>();

    cmdProvider.generateSms(
      widget.command,
      _collectValues(),
      appProvider.trackerNumber,
      appProvider.selectedDevice,
    );

    setState(() => _showPreview = true);
  }

  Future<void> _sendSms() async {
    if (!_showPreview) {
      _generateSms();
      return;
    }

    final cmdProvider = context.read<CommandProvider>();
    if (cmdProvider.lastGeneratedCommand == null) {
      _generateSms();
      return;
    }

    // Danger confirmation
    if (_isDangerous) {
      final confirmed = await _showDangerDialog();
      if (!confirmed) return;
    }

    final result = await cmdProvider.sendSms();

    if (!mounted) return;

    if (result == SmsResult.sent) {
      _showSnackBar('SMS sent successfully ✓', success: true);
    } else if (result == SmsResult.permissionDenied) {
      _showSnackBar('SMS permission denied. Please grant permission in settings.', success: false);
    } else {
      _showSnackBar('Failed to send SMS. Please try again.', success: false);
    }
  }

  Future<bool> _showDangerDialog() async {
    return await showDialog<bool>(
          context: context,
          builder: (ctx) => AlertDialog(
            shape: RoundedRectangleBorder(
              borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
            ),
            title: Row(
              children: [
                Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    color: AppColors.error.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Icon(Icons.warning_rounded, color: AppColors.error, size: 24),
                ),
                const SizedBox(width: AppDimensions.sm),
                const Text('Warning', style: TextStyle(fontSize: AppDimensions.fontXl)),
              ],
            ),
            content: Text(
              widget.command.dangerMessage ?? 'This is a dangerous operation. Are you sure?',
              style: const TextStyle(fontSize: AppDimensions.fontMd),
            ),
            actions: [
              TextButton(
                onPressed: () => Navigator.pop(ctx, false),
                child: const Text('Cancel'),
              ),
              ElevatedButton(
                onPressed: () => Navigator.pop(ctx, true),
                style: ElevatedButton.styleFrom(
                  backgroundColor: AppColors.error,
                  foregroundColor: Colors.white,
                ),
                child: const Text('Confirm'),
              ),
            ],
          ),
        ) ??
        false;
  }

  void _copyToClipboard(String text) {
    Clipboard.setData(ClipboardData(text: text));
    _showSnackBar('Copied to clipboard', success: true);
  }

  void _showSnackBar(String message, {required bool success}) {
    ScaffoldMessenger.of(context).clearSnackBars();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Row(
          children: [
            Icon(
              success ? Icons.check_circle_rounded : Icons.error_rounded,
              color: Colors.white,
              size: 20,
            ),
            const SizedBox(width: 8),
            Expanded(child: Text(message)),
          ],
        ),
        backgroundColor: success ? AppColors.success : AppColors.error,
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
        ),
        duration: const Duration(seconds: 3),
      ),
    );
  }

  void _applyServerPreset(Map<String, dynamic> preset) {
    setState(() {
      _selectedPreset = preset['name'] as String;
    });
    if (_controllers.containsKey('server')) {
      _controllers['server']!.text = preset['host'] as String;
    }
    if (_controllers.containsKey('port')) {
      _controllers['port']!.text = preset['port'] as String;
    }
  }

  Color _categoryColor() {
    switch (widget.command.category) {
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

  IconData _categoryIcon() {
    switch (widget.command.category) {
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

  @override
  Widget build(BuildContext context) {
    final appProvider = context.watch<AppProvider>();
    final cmdProvider = context.watch<CommandProvider>();
    final isSomali = appProvider.isSomali;
    final isDark = appProvider.isDarkMode;
    final catColor = _categoryColor();
    final smsText = cmdProvider.lastGeneratedCommand?.generatedSms;

    final isSetServer = widget.command.id == 'net_set_server' ||
        widget.command.id == 'net_set_backup_server';

    return Scaffold(
      appBar: AppBar(
        title: Text(isSomali ? widget.command.nameSo : widget.command.name),
        actions: [
          // Favorite toggle
          Consumer<CommandProvider>(
            builder: (_, p, __) {
              final isFav = p.isFavorite(widget.command.id);
              return IconButton(
                icon: Icon(
                  isFav ? Icons.star_rounded : Icons.star_outline_rounded,
                  color: isFav ? AppColors.primary : Colors.white70,
                ),
                onPressed: () {
                  p.toggleFavorite(
                    widget.command.id,
                    isSomali ? widget.command.nameSo : widget.command.name,
                    isSomali ? widget.command.category.nameSo : widget.command.category.name,
                  );
                },
              );
            },
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(AppDimensions.pagePadding),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Command Info Card
            Container(
              padding: const EdgeInsets.all(AppDimensions.md),
              decoration: BoxDecoration(
                color: catColor.withOpacity(0.08),
                borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
                border: Border.all(color: catColor.withOpacity(0.2)),
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    decoration: BoxDecoration(
                      color: catColor.withOpacity(0.15),
                      borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                    ),
                    child: Icon(_categoryIcon(), color: catColor, size: 22),
                  ),
                  const SizedBox(width: AppDimensions.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          isSomali ? widget.command.nameSo : widget.command.name,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            fontSize: AppDimensions.fontLg,
                            color: catColor,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          isSomali ? widget.command.descriptionSo : widget.command.description,
                          style: const TextStyle(
                            fontSize: AppDimensions.fontSm,
                            color: AppColors.grey600,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            ).animate().fade(duration: 300.ms),

            if (_isDangerous) ...[
              const SizedBox(height: AppDimensions.md),
              Container(
                padding: const EdgeInsets.all(AppDimensions.md),
                decoration: BoxDecoration(
                  color: AppColors.error.withOpacity(0.08),
                  borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
                  border: Border.all(color: AppColors.error.withOpacity(0.3)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.warning_amber_rounded, color: AppColors.error, size: 20),
                    const SizedBox(width: AppDimensions.sm),
                    Expanded(
                      child: Text(
                        widget.command.dangerMessage ?? 'This is a dangerous operation!',
                        style: const TextStyle(
                          color: AppColors.error,
                          fontSize: AppDimensions.fontSm,
                          fontWeight: FontWeight.w500,
                        ),
                      ),
                    ),
                  ],
                ),
              ).animate(delay: 100.ms).fade(),
            ],

            // Target info
            const SizedBox(height: AppDimensions.lg),
            _InfoRow(
              label: isSomali ? 'Lambarka Tracker-ka' : 'Tracker Number',
              value: appProvider.trackerNumber,
              icon: Icons.sim_card_outlined,
              isDark: isDark,
            ).animate(delay: 150.ms).fade(),
            const SizedBox(height: AppDimensions.sm),
            _InfoRow(
              label: isSomali ? 'Nooca Qalabka' : 'Device Model',
              value: appProvider.selectedDevice,
              icon: Icons.router_outlined,
              isDark: isDark,
            ).animate(delay: 200.ms).fade(),

            // Server Presets (only for set server commands)
            if (isSetServer) ...[
              const SizedBox(height: AppDimensions.lg),
              Text(
                isSomali ? 'Qaabeynta Server-ka' : 'Server Presets',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: AppDimensions.sm),
              SizedBox(
                height: 60,
                child: ListView(
                  scrollDirection: Axis.horizontal,
                  children: ServerPresets.presets.map((preset) {
                    final isSelected = _selectedPreset == preset['name'];
                    return GestureDetector(
                      onTap: () => _applyServerPreset(preset),
                      child: AnimatedContainer(
                        duration: const Duration(milliseconds: 200),
                        margin: const EdgeInsets.only(right: AppDimensions.sm),
                        padding: const EdgeInsets.symmetric(
                          horizontal: AppDimensions.md,
                          vertical: AppDimensions.sm,
                        ),
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
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            Text(
                              preset['name'] as String,
                              style: TextStyle(
                                color: isSelected ? Colors.white : AppColors.grey700,
                                fontWeight: FontWeight.w700,
                                fontSize: AppDimensions.fontSm,
                              ),
                            ),
                            Text(
                              '${preset['host']}:${preset['port']}',
                              style: TextStyle(
                                color: isSelected ? Colors.white70 : AppColors.grey500,
                                fontSize: AppDimensions.fontXs,
                              ),
                            ),
                          ],
                        ),
                      ),
                    );
                  }).toList(),
                ),
              ),
            ],

            // Form Fields
            if (widget.command.fields.isNotEmpty) ...[
              const SizedBox(height: AppDimensions.lg),
              Text(
                isSomali ? 'Buuxi Xogta' : 'Fill in Details',
                style: Theme.of(context).textTheme.titleSmall?.copyWith(
                      fontWeight: FontWeight.w700,
                    ),
              ),
              const SizedBox(height: AppDimensions.sm),
              ...widget.command.fields.asMap().entries.map((entry) {
                final idx = entry.key;
                final field = entry.value;
                return Padding(
                  padding: const EdgeInsets.only(bottom: AppDimensions.md),
                  child: _buildField(field, isSomali, isDark),
                ).animate(delay: Duration(milliseconds: 100 + 50 * idx)).slideX(
                      begin: 0.05,
                      end: 0,
                      duration: 300.ms,
                    ).fade(duration: 300.ms);
              }),
            ],

            // SMS Template preview
            const SizedBox(height: AppDimensions.md),
            _TemplatePreview(template: widget.command.template, isDark: isDark)
                .animate(delay: 300.ms)
                .fade(),

            const SizedBox(height: AppDimensions.xl),

            // Generate Button
            AppPrimaryButton(
              label: isSomali ? 'Samee SMS' : 'Generate SMS',
              icon: Icons.code_rounded,
              onPressed: _generateSms,
            ).animate(delay: 350.ms).slideY(begin: 0.2, end: 0).fade(),

            // SMS Preview
            if (_showPreview && smsText != null) ...[
              const SizedBox(height: AppDimensions.lg),
              _SmsPreviewCard(
                smsText: smsText,
                isDark: isDark,
                isSomali: isSomali,
                onCopy: () => _copyToClipboard(smsText),
              ).animate().scale(
                    begin: const Offset(0.95, 0.95),
                    end: const Offset(1.0, 1.0),
                    duration: 300.ms,
                    curve: Curves.easeOutBack,
                  ).fade(),

              const SizedBox(height: AppDimensions.lg),

              // Send Button
              _SendButton(
                isSomali: isSomali,
                isSending: cmdProvider.isSending,
                onSend: _sendSms,
              ).animate(delay: 100.ms).slideY(begin: 0.2, end: 0).fade(),
            ],

            const SizedBox(height: AppDimensions.xl),
          ],
        ),
      ),
    );
  }

  Widget _buildField(CommandField field, bool isSomali, bool isDark) {
    final label = isSomali ? field.labelSo : field.label;
    final hint = isSomali ? field.hintSo : field.hint;
    final error = _errors[field.key];

    switch (field.type) {
      case FieldType.dropdown:
        return _DropdownField(
          field: field,
          label: label,
          isDark: isDark,
          value: _dropdownValues[field.key],
          errorText: error,
          onChanged: (val) {
            setState(() {
              _dropdownValues[field.key] = val;
              _errors[field.key] = null;
              _showPreview = false;
            });
          },
        );

      case FieldType.number:
        return AppTextField(
          controller: _controllers[field.key]!,
          label: label,
          hint: hint,
          keyboardType: TextInputType.number,
          inputFormatters: [FilteringTextInputFormatter.digitsOnly],
          suffix: field.suffix,
          errorText: error,
          maxLength: field.maxLength,
          onChanged: (_) => setState(() {
            _errors[field.key] = null;
            _showPreview = false;
          }),
        );

      default:
        return AppTextField(
          controller: _controllers[field.key]!,
          label: label,
          hint: hint,
          errorText: error,
          maxLength: field.maxLength,
          onChanged: (_) => setState(() {
            _errors[field.key] = null;
            _showPreview = false;
          }),
        );
    }
  }
}

class _DropdownField extends StatelessWidget {
  final CommandField field;
  final String label;
  final bool isDark;
  final String? value;
  final String? errorText;
  final ValueChanged<String?> onChanged;

  const _DropdownField({
    required this.field,
    required this.label,
    required this.isDark,
    this.value,
    this.errorText,
    required this.onChanged,
  });

  @override
  Widget build(BuildContext context) {
    final fillColor = isDark ? AppColors.darkCard : AppColors.grey100;
    final borderColor = errorText != null ? AppColors.error : (isDark ? AppColors.darkBorder : AppColors.grey300);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          label,
          style: const TextStyle(
            fontWeight: FontWeight.w600,
            fontSize: AppDimensions.fontMd,
            color: AppColors.grey700,
          ),
        ),
        const SizedBox(height: 6),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: AppDimensions.md),
          decoration: BoxDecoration(
            color: fillColor,
            borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
            border: Border.all(color: borderColor),
          ),
          child: DropdownButtonHideUnderline(
            child: DropdownButton<String>(
              value: value,
              isExpanded: true,
              dropdownColor: isDark ? AppColors.darkCard : Colors.white,
              borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
              icon: const Icon(Icons.keyboard_arrow_down_rounded, color: AppColors.grey500),
              hint: Text(
                field.hint,
                style: const TextStyle(color: AppColors.grey400, fontSize: AppDimensions.fontSm),
              ),
              items: field.options!.map((opt) {
                return DropdownMenuItem(value: opt, child: Text(opt));
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
        if (field.hint.isNotEmpty) ...[
          const SizedBox(height: 4),
          Padding(
            padding: const EdgeInsets.only(left: 4),
            child: Text(
              field.hint,
              style: const TextStyle(color: AppColors.grey500, fontSize: AppDimensions.fontXs),
            ),
          ),
        ],
      ],
    );
  }
}

class _InfoRow extends StatelessWidget {
  final String label;
  final String value;
  final IconData icon;
  final bool isDark;

  const _InfoRow({
    required this.label,
    required this.value,
    required this.icon,
    required this.isDark,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: AppDimensions.md,
        vertical: AppDimensions.sm,
      ),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkCard : AppColors.grey100,
        borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
        border: Border.all(color: isDark ? AppColors.darkBorder : AppColors.grey200),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: AppColors.secondary),
          const SizedBox(width: AppDimensions.sm),
          Text(
            '$label: ',
            style: const TextStyle(
              color: AppColors.grey500,
              fontSize: AppDimensions.fontSm,
            ),
          ),
          Expanded(
            child: Text(
              value,
              style: const TextStyle(
                fontWeight: FontWeight.w600,
                fontSize: AppDimensions.fontSm,
              ),
              overflow: TextOverflow.ellipsis,
            ),
          ),
        ],
      ),
    );
  }
}

class _TemplatePreview extends StatelessWidget {
  final String template;
  final bool isDark;

  const _TemplatePreview({required this.template, required this.isDark});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AppDimensions.md),
      decoration: BoxDecoration(
        color: isDark ? AppColors.darkCard : AppColors.grey100,
        borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
        border: Border.all(color: isDark ? AppColors.darkBorder : AppColors.grey300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'SMS Template',
            style: TextStyle(
              fontSize: AppDimensions.fontXs,
              color: AppColors.grey500,
              fontWeight: FontWeight.w600,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            template,
            style: const TextStyle(
              fontFamily: 'monospace',
              fontSize: AppDimensions.fontSm,
              color: AppColors.secondary,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ),
    );
  }
}

class _SmsPreviewCard extends StatelessWidget {
  final String smsText;
  final bool isDark;
  final bool isSomali;
  final VoidCallback onCopy;

  const _SmsPreviewCard({
    required this.smsText,
    required this.isDark,
    required this.isSomali,
    required this.onCopy,
  });

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(AppDimensions.md),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [
            AppColors.secondary.withOpacity(0.05),
            AppColors.secondary.withOpacity(0.02),
          ],
        ),
        borderRadius: BorderRadius.circular(AppDimensions.radiusLg),
        border: Border.all(color: AppColors.secondary.withOpacity(0.3), width: 1.5),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Container(
                padding: const EdgeInsets.all(6),
                decoration: BoxDecoration(
                  color: AppColors.success.withOpacity(0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: const Icon(Icons.check_circle_rounded, color: AppColors.success, size: 16),
              ),
              const SizedBox(width: AppDimensions.sm),
              Text(
                isSomali ? 'Daawo SMS' : 'SMS Preview',
                style: const TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: AppDimensions.fontMd,
                  color: AppColors.secondary,
                ),
              ),
              const Spacer(),
              GestureDetector(
                onTap: onCopy,
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: AppColors.secondary.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(AppDimensions.radiusRound),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      const Icon(Icons.copy_rounded, size: 12, color: AppColors.secondary),
                      const SizedBox(width: 4),
                      Text(
                        isSomali ? 'Koobiyee' : 'Copy',
                        style: const TextStyle(
                          fontSize: AppDimensions.fontXs,
                          color: AppColors.secondary,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: AppDimensions.sm),
          const Divider(height: 1),
          const SizedBox(height: AppDimensions.sm),
          SelectableText(
            smsText,
            style: TextStyle(
              fontFamily: 'monospace',
              fontSize: AppDimensions.fontLg,
              fontWeight: FontWeight.w700,
              color: isDark ? AppColors.darkText : AppColors.grey900,
              letterSpacing: 0.5,
            ),
          ),
          const SizedBox(height: AppDimensions.sm),
          Row(
            children: [
              const Icon(Icons.info_outline_rounded, size: 12, color: AppColors.grey400),
              const SizedBox(width: 4),
              Text(
                '${smsText.length} characters',
                style: const TextStyle(
                  color: AppColors.grey400,
                  fontSize: AppDimensions.fontXs,
                ),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

class _SendButton extends StatelessWidget {
  final bool isSomali;
  final bool isSending;
  final VoidCallback onSend;

  const _SendButton({
    required this.isSomali,
    required this.isSending,
    required this.onSend,
  });

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: double.infinity,
      height: AppDimensions.buttonHeightLg,
      child: ElevatedButton.icon(
        onPressed: isSending ? null : onSend,
        style: ElevatedButton.styleFrom(
          backgroundColor: AppColors.success,
          foregroundColor: Colors.white,
          disabledBackgroundColor: AppColors.success.withOpacity(0.5),
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(AppDimensions.radiusMd),
          ),
        ),
        icon: isSending
            ? const SizedBox(
                width: 20,
                height: 20,
                child: CircularProgressIndicator(
                  strokeWidth: 2,
                  valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
                ),
              )
            : const Icon(Icons.send_rounded, size: 22),
        label: Text(
          isSending
              ? 'Sending...'
              : (isSomali ? 'Dir SMS' : 'Send SMS'),
          style: const TextStyle(
            fontSize: AppDimensions.fontLg,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
    );
  }
}
