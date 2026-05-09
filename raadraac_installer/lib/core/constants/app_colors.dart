import 'package:flutter/material.dart';

class AppColors {
  // Brand Colors
  static const Color primary = Color(0xFFFFD700);       // Somtel Gold
  static const Color secondary = Color(0xFF222D5D);     // Somtel Navy
  static const Color background = Color(0xFFFFFFFF);    // White

  // Derived Colors
  static const Color primaryDark = Color(0xFFE5C200);
  static const Color primaryLight = Color(0xFFFFF3B0);
  static const Color secondaryLight = Color(0xFF2E3D7A);
  static const Color secondaryDark = Color(0xFF161E40);

  // Status Colors
  static const Color success = Color(0xFF2ECC71);
  static const Color error = Color(0xFFE74C3C);
  static const Color warning = Color(0xFFF39C12);
  static const Color info = Color(0xFF3498DB);

  // Neutral Colors
  static const Color grey100 = Color(0xFFF5F5F5);
  static const Color grey200 = Color(0xFFEEEEEE);
  static const Color grey300 = Color(0xFFE0E0E0);
  static const Color grey400 = Color(0xFFBDBDBD);
  static const Color grey500 = Color(0xFF9E9E9E);
  static const Color grey600 = Color(0xFF757575);
  static const Color grey700 = Color(0xFF616161);
  static const Color grey800 = Color(0xFF424242);
  static const Color grey900 = Color(0xFF212121);

  // Dark Mode Colors
  static const Color darkBackground = Color(0xFF0F1117);
  static const Color darkSurface = Color(0xFF1A1D2E);
  static const Color darkCard = Color(0xFF222536);
  static const Color darkBorder = Color(0xFF2D3250);
  static const Color darkText = Color(0xFFF0F0F0);
  static const Color darkTextSecondary = Color(0xFFB0B5CC);

  // Category Colors
  static const Color categorySystem = Color(0xFF3498DB);
  static const Color categoryNetwork = Color(0xFF9B59B6);
  static const Color categoryTracking = Color(0xFF2ECC71);
  static const Color categoryOutputs = Color(0xFFE74C3C);
  static const Color categoryBluetooth = Color(0xFF1ABC9C);

  // Shadow
  static final Color shadowLight = Colors.black.withOpacity(0.08);
  static final Color shadowDark = Colors.black.withOpacity(0.25);

  // Gradient
  static const LinearGradient primaryGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [secondary, secondaryLight],
  );

  static const LinearGradient goldGradient = LinearGradient(
    begin: Alignment.topLeft,
    end: Alignment.bottomRight,
    colors: [primary, primaryDark],
  );
}
