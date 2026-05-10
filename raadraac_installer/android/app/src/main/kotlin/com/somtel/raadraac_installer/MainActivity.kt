package com.somtel.raadraac_installer

import android.content.Context
import android.os.Build
import android.telephony.SmsManager
import android.telephony.SubscriptionManager
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugins.GeneratedPluginRegistrant

class MainActivity : FlutterActivity() {
    private val CHANNEL = "com.somtel.raadraac_installer/sim"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        GeneratedPluginRegistrant.registerWith(flutterEngine)

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "getSimCards" -> {
                        try {
                            result.success(getSimCards())
                        } catch (e: Exception) {
                            result.error("SIM_ERROR", e.message, null)
                        }
                    }
                    "sendSms" -> {
                        val phone = call.argument<String>("phone") ?: ""
                        val message = call.argument<String>("message") ?: ""
                        val subscriptionId = call.argument<Int>("subscriptionId")
                        try {
                            sendSmsNative(phone, message, subscriptionId)
                            result.success("sent")
                        } catch (e: Exception) {
                            result.error("SMS_ERROR", e.message, null)
                        }
                    }
                    else -> result.notImplemented()
                }
            }
    }

    private fun getSimCards(): List<Map<String, Any>> {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.LOLLIPOP_MR1) {
            return listOf(mapOf("subscriptionId" to -1, "displayName" to "SIM 1", "number" to "", "slotIndex" to 0))
        }
        val subscriptionManager = getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager
        val subs = subscriptionManager.activeSubscriptionInfoList ?: return emptyList()
        return subs.map { sub ->
            mapOf(
                "subscriptionId" to sub.subscriptionId,
                "displayName" to (sub.displayName?.toString() ?: "SIM ${sub.simSlotIndex + 1}"),
                "number" to (sub.number ?: ""),
                "slotIndex" to sub.simSlotIndex,
            )
        }
    }

    @Suppress("DEPRECATION")
    private fun sendSmsNative(phone: String, message: String, subscriptionId: Int?) {
        val smsManager = if (subscriptionId != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
        } else {
            SmsManager.getDefault()
        }
        if (message.length > 160) {
            val parts = smsManager.divideMessage(message)
            smsManager.sendMultipartTextMessage(phone, null, parts, null, null)
        } else {
            smsManager.sendTextMessage(phone, null, message, null, null)
        }
    }
}
