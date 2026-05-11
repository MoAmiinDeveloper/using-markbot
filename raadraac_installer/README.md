# Raadraac Installer Tools

**Professional GPS Device Installer Application for Somtel**

A production-ready Flutter Android application designed for GPS field technicians, support engineers, and fleet management teams working with Teltonika GPS devices.

---

## Overview

Raadraac Installer Tools allows field technicians to send Teltonika GPS device SMS commands by pressing buttons — no manual command typing required. The app dynamically generates correct Teltonika SMS syntax from user inputs.

**Company:** Somtel  
**Target:** Teltonika GPS device installers  
**Platform:** Android 8.0+ (API 26+)  
**Technology:** Flutter / Dart  

---

## Features

- **One-tap SMS commands** — Press a button, fill minimal fields, send
- **5 Device models** — FMC130, FMB920, FMC650, FMT100, FMB120
- **5 Command categories** — System, Network, Tracking, Outputs, Bluetooth
- **20+ Teltonika commands** — Full command database with SMS templates
- **Server presets** — Wialon, GPSWOX, Traccar, Navixy one-tap configuration
- **Command history** — View, resend, or delete past commands
- **Favorites** — Star frequently used commands
- **Offline-first** — Works without internet (Hive local storage)
- **Dark mode** — Full dark theme support
- **Bilingual** — English and Somali language support
- **Field-optimized UI** — Large buttons, high contrast, outdoor-readable

---

## Supported Teltonika Commands

### System
| Command | SMS Template |
|---------|-------------|
| Reboot | `reboot` |
| Get Info | `getinfo` |
| Get Version | `getver` |
| Factory Reset | `cpureset` |
| Flush Data | `flush` |
| Get Record Count | `getrecord` |

### Network
| Command | SMS Template |
|---------|-------------|
| Set APN | `setparam 2001:{apn} 2002:{user} 2003:{pass}` |
| Set Server | `setparam 2004:{server} 2005:{port}` |
| Set Backup Server | `setparam 2006:{server} 2007:{port}` |
| Set Protocol | `setparam 2009:{0\|1}` |
| Get Network Params | `getparam 2001 2004 2005 2006` |

### Tracking
| Command | SMS Template |
|---------|-------------|
| Set Min Period | `setparam 10001:{seconds}` |
| Set Send Period | `setparam 10002:{seconds}` |
| Moving Intervals | `setparam 10001:{moving} 10003:{stopped}` |
| Ignition Source | `setparam 10200:{source}` |
| Roaming Settings | `setparam 2000:{0\|1\|2}` |
| Sleep Mode | `setparam 10050:{mode}` |
| Get GPS Status | `ggps` |

### Outputs
| Command | SMS Template |
|---------|-------------|
| Engine Cut (DOUT1 ON) | `setdigout 1?1:0` |
| Engine Restore (DOUT1 OFF) | `setdigout 0?1:0` |
| Digital Output 1 | `setdigout {state}?1:0` |
| Digital Output 2 | `setdigout {state}?2:0` |
| Buzzer | `setdigout 1?3:0 {duration}000` |
| Relay ON | `setdigout 1` |
| Relay OFF | `setdigout 0` |

### Bluetooth
| Command | SMS Template |
|---------|-------------|
| BLE Scan | `blescan` |
| Enable Bluetooth | `setparam 11000:1` |
| Disable Bluetooth | `setparam 11000:0` |
| Pair BLE Sensor | `setparam 11002.1:{mac}` |
| BLE Status | `getparam 11000 11002` |

---

## App Flow

```
Splash Screen
    └── Home Screen
            ├── [Enter SIM Number] [Select Device Model]
            └── Continue →
                    └── Commands Screen
                            ├── [Search] [Category Filter]
                            └── Tap Command →
                                    └── Command Form Screen
                                            ├── [Fill Fields]
                                            ├── [Generate SMS] → SMS Preview
                                            ├── [Copy SMS]
                                            └── [Send SMS] →→→ Device
```

---

## Project Structure

```
raadraac_installer/
├── android/
│   └── app/src/main/
│       └── AndroidManifest.xml       # SMS + Phone permissions
├── lib/
│   ├── main.dart                     # App entry point
│   ├── app.dart                      # MaterialApp + Providers
│   ├── core/
│   │   ├── constants/
│   │   │   ├── app_colors.dart       # Brand colors (Gold #FFD700, Navy #222D5D)
│   │   │   ├── app_strings.dart      # EN + Somali strings
│   │   │   └── app_dimensions.dart   # Spacing, sizes, radii
│   │   └── themes/
│   │       └── app_theme.dart        # Light + Dark ThemeData
│   ├── models/
│   │   ├── command_model.dart        # Command + category definitions
│   │   ├── command_field_model.dart  # Field types (text, dropdown, number)
│   │   └── command_history_model.dart # History + Favorites models
│   ├── data/
│   │   ├── commands_data.dart        # Full Teltonika command database
│   │   └── device_models_data.dart   # Supported device models
│   ├── services/
│   │   ├── sms_service.dart          # SMS sending via telephony package
│   │   └── storage_service.dart      # Hive local storage (history, favorites, settings)
│   ├── providers/
│   │   ├── app_provider.dart         # App state (tracker number, device, dark mode, lang)
│   │   └── command_provider.dart     # Commands, filtering, SMS generation
│   ├── screens/
│   │   ├── splash/splash_screen.dart
│   │   ├── home/home_screen.dart
│   │   ├── commands/commands_screen.dart
│   │   ├── command_form/command_form_screen.dart
│   │   ├── history/history_screen.dart
│   │   ├── favorites/favorites_screen.dart
│   │   └── settings/settings_screen.dart
│   └── widgets/
│       ├── command_card.dart
│       └── common/
│           ├── app_button.dart
│           └── app_text_field.dart
├── assets/
│   └── translations/
│       ├── en.json
│       └── so.json
└── test/
    └── widget_test.dart              # Unit tests for command SMS generation
```

---

## Setup Instructions

### Prerequisites

- Flutter SDK 3.x+
- Android Studio / VS Code
- Android device or emulator (API 26+)
- Java 11+

### Installation

```bash
# 1. Clone the repository
git clone <repository-url>
cd raadraac_installer

# 2. Install dependencies
flutter pub get

# 3. Generate Hive adapters (if modifying models)
flutter pub run build_runner build --delete-conflicting-outputs

# 4. Run on device
flutter run

# 5. Build release APK
flutter build apk --release

# 6. Build App Bundle (for Play Store)
flutter build appbundle --release
```

### First-time setup

1. Connect an Android device (USB debugging enabled) or start an emulator
2. Run `flutter devices` to confirm device is detected
3. Run `flutter run` to build and install
4. Grant SMS permission when prompted on first launch

---

## Brand Colors

| Name | Hex | Usage |
|------|-----|-------|
| Somtel Gold | `#FFD700` | Primary actions, highlights, selected states |
| Somtel Navy | `#222D5D` | AppBar, secondary actions, headers |
| White | `#FFFFFF` | Background |
| Success Green | `#2ECC71` | Send SMS button, success states |
| Error Red | `#E74C3C` | Dangerous commands, errors |

---

## Android Permissions

```xml
<uses-permission android:name="android.permission.SEND_SMS" />
<uses-permission android:name="android.permission.RECEIVE_SMS" />
<uses-permission android:name="android.permission.READ_SMS" />
<uses-permission android:name="android.permission.READ_PHONE_STATE" />
<uses-permission android:name="android.permission.INTERNET" />
```

---

## Command Template Engine

Commands use dynamic templates with `{key}` placeholders:

```
Template: setparam 2001:{apn} 2002:{apn_username} 2003:{apn_password}
Input:    apn=internet, apn_username=, apn_password=
Output:   setparam 2001:internet 2002: 2003:
```

```
Template: setparam 2004:{server} 2005:{port}
Input:    server=track.somtel.net, port=21212
Output:   setparam 2004:track.somtel.net 2005:21212
```

---

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `provider` | ^6.1.1 | State management |
| `hive` | ^2.2.3 | Local storage |
| `hive_flutter` | ^1.1.0 | Hive Flutter integration |
| `telephony` | ^0.2.0 | Send SMS |
| `permission_handler` | ^11.1.0 | Runtime permissions |
| `flutter_animate` | ^4.3.0 | Smooth animations |
| `google_fonts` | ^6.1.0 | Typography |
| `intl` | ^0.19.0 | Date formatting |
| `share_plus` | ^7.2.1 | Share SMS text |

---

## Running Tests

```bash
flutter test
```

Tests cover:
- SMS template generation for all command types
- Command filtering by category
- Search functionality
- Dangerous command flags

---

## Building for Production

```bash
# Generate release keystore (first time only)
keytool -genkey -v -keystore somtel-release.jks -keyAlias somtel \
  -keyalg RSA -keysize 2048 -validity 10000

# Add signing config to android/app/build.gradle

# Build signed APK
flutter build apk --release

# Build signed AAB (recommended for Play Store)
flutter build appbundle --release
```

---

## Support

**Company:** Somtel  
**App:** Raadraac Installer Tools  
**Platform:** Android 8.0+ (API 26+)  
**Compatible Devices:** Teltonika FMC130, FMB920, FMC650, FMT100, FMB120
