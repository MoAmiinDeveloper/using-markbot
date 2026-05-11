import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:permission_handler/permission_handler.dart';
import '../models/sim_card.dart';

enum SmsResult {
  sent,
  failed,
  permissionDenied,
  simNotAvailable,
}

class SmsService {
  static SmsService? _instance;
  static SmsService get instance => _instance ??= SmsService._();
  SmsService._();

  static const _channel = MethodChannel('com.somtel.raadraac_installer/sim');

  Future<bool> requestPermissions() async {
    final smsStatus = await Permission.sms.request();
    final phoneStatus = await Permission.phone.request();
    return smsStatus.isGranted && phoneStatus.isGranted;
  }

  Future<bool> hasPermissions() async {
    return (await Permission.sms.status).isGranted;
  }

  Future<List<SimCard>> getSimCards() async {
    try {
      final List<dynamic> result = await _channel.invokeMethod('getSimCards');
      return result.map((e) => SimCard.fromMap(e as Map)).toList();
    } catch (e) {
      debugPrint('getSimCards error: $e');
      return [];
    }
  }

  Future<SmsResult> sendSms({
    required String phoneNumber,
    required String message,
    int? subscriptionId,
  }) async {
    try {
      final hasPerms = await hasPermissions();
      if (!hasPerms) {
        final granted = await requestPermissions();
        if (!granted) return SmsResult.permissionDenied;
      }

      final args = <String, dynamic>{
        'phone': phoneNumber,
        'message': message,
      };
      if (subscriptionId != null) args['subscriptionId'] = subscriptionId;

      await _channel.invokeMethod('sendSms', args);
      debugPrint('SMS sent to $phoneNumber via subscriptionId=$subscriptionId');
      return SmsResult.sent;
    } catch (e) {
      debugPrint('SMS send error: $e');
      return SmsResult.failed;
    }
  }

  String formatPhoneNumber(String number) {
    String cleaned = number.replaceAll(RegExp(r'[^\d+]'), '');
    if (!cleaned.startsWith('+') && !cleaned.startsWith('00')) {
      if (cleaned.startsWith('0')) {
        cleaned = '+252${cleaned.substring(1)}';
      }
    }
    return cleaned;
  }

  bool isValidPhoneNumber(String number) {
    final cleaned = number.replaceAll(RegExp(r'[^\d+]'), '');
    return cleaned.length >= 7 && cleaned.length <= 15;
  }
}
