import 'package:flutter/foundation.dart';
import 'package:telephony/telephony.dart';
import 'package:permission_handler/permission_handler.dart';

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

  final Telephony _telephony = Telephony.instance;

  Future<bool> requestPermissions() async {
    final smsStatus = await Permission.sms.request();
    final phoneStatus = await Permission.phone.request();
    return smsStatus.isGranted && phoneStatus.isGranted;
  }

  Future<bool> hasPermissions() async {
    final sms = await Permission.sms.status;
    return sms.isGranted;
  }

  Future<SmsResult> sendSms({
    required String phoneNumber,
    required String message,
  }) async {
    try {
      final hasPerms = await hasPermissions();
      if (!hasPerms) {
        final granted = await requestPermissions();
        if (!granted) return SmsResult.permissionDenied;
      }

      bool sent = false;

      await _telephony.sendSms(
        to: phoneNumber,
        message: message,
        statusListener: (SendStatus status) {
          if (status == SendStatus.SENT) {
            sent = true;
            debugPrint('SMS sent to $phoneNumber');
          } else {
            debugPrint('SMS delivery status: $status');
          }
        },
        isMultipart: message.length > 160,
      );

      // Give a moment for the callback
      await Future.delayed(const Duration(milliseconds: 500));
      return SmsResult.sent;
    } on Exception catch (e) {
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
