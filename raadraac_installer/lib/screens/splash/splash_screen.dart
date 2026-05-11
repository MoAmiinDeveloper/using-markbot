import 'package:flutter/material.dart';
import 'package:flutter_animate/flutter_animate.dart';
import '../../core/constants/app_colors.dart';
import '../../core/constants/app_dimensions.dart';
import '../../services/storage_service.dart';
import '../home/home_screen.dart';

class SplashScreen extends StatefulWidget {
  const SplashScreen({super.key});

  @override
  State<SplashScreen> createState() => _SplashScreenState();
}

class _SplashScreenState extends State<SplashScreen> {
  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    await StorageService.instance.init();
    await Future.delayed(const Duration(milliseconds: 2200));
    if (mounted) {
      Navigator.of(context).pushReplacement(
        PageRouteBuilder(
          pageBuilder: (_, a, __) => const HomeScreen(),
          transitionsBuilder: (_, anim, __, child) {
            return FadeTransition(opacity: anim, child: child);
          },
          transitionDuration: const Duration(milliseconds: 400),
        ),
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Container(
        width: double.infinity,
        height: double.infinity,
        decoration: const BoxDecoration(
          gradient: AppColors.primaryGradient,
        ),
        child: SafeArea(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Spacer(flex: 2),

              // Logo Container
              Container(
                width: 110,
                height: 110,
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(AppDimensions.radiusXl),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withOpacity(0.2),
                      blurRadius: 30,
                      offset: const Offset(0, 10),
                    ),
                  ],
                ),
                child: Center(
                  child: _SomtelLogoWidget(size: 70),
                ),
              )
                  .animate()
                  .scale(
                    begin: const Offset(0.5, 0.5),
                    end: const Offset(1.0, 1.0),
                    duration: const Duration(milliseconds: 600),
                    curve: Curves.elasticOut,
                  )
                  .fade(duration: const Duration(milliseconds: 400)),

              const SizedBox(height: AppDimensions.xl),

              // Company Name
              const Text(
                'SOMTEL',
                style: TextStyle(
                  color: AppColors.primary,
                  fontSize: 32,
                  fontWeight: FontWeight.w900,
                  letterSpacing: 6,
                ),
              )
                  .animate(delay: const Duration(milliseconds: 300))
                  .slideY(begin: 0.3, end: 0)
                  .fade(),

              const SizedBox(height: AppDimensions.sm),

              // App Name
              const Text(
                'Raadraac Installer',
                style: TextStyle(
                  color: Colors.white,
                  fontSize: AppDimensions.fontXxl,
                  fontWeight: FontWeight.w600,
                  letterSpacing: 1.5,
                ),
              )
                  .animate(delay: const Duration(milliseconds: 450))
                  .slideY(begin: 0.3, end: 0)
                  .fade(),

              const SizedBox(height: AppDimensions.sm),

              // Tagline
              const Text(
                'Professional GPS Installer Tools',
                style: TextStyle(
                  color: Colors.white60,
                  fontSize: AppDimensions.fontMd,
                  fontWeight: FontWeight.w400,
                  letterSpacing: 0.5,
                ),
              )
                  .animate(delay: const Duration(milliseconds: 550))
                  .fade(),

              const Spacer(flex: 2),

              // Loading indicator
              SizedBox(
                width: 140,
                child: ClipRRect(
                  borderRadius: BorderRadius.circular(AppDimensions.radiusRound),
                  child: const LinearProgressIndicator(
                    backgroundColor: Colors.white24,
                    valueColor: AlwaysStoppedAnimation<Color>(AppColors.primary),
                    minHeight: 3,
                  ),
                ),
              )
                  .animate(delay: const Duration(milliseconds: 700))
                  .fade(),

              const SizedBox(height: AppDimensions.xl),

              // Version
              const Text(
                'v1.0.0  |  Teltonika Compatible',
                style: TextStyle(
                  color: Colors.white38,
                  fontSize: AppDimensions.fontSm,
                ),
              )
                  .animate(delay: const Duration(milliseconds: 800))
                  .fade(),

              const SizedBox(height: AppDimensions.lg),
            ],
          ),
        ),
      ),
    );
  }
}

class _SomtelLogoWidget extends StatelessWidget {
  final double size;
  const _SomtelLogoWidget({required this.size});

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _SomtelLogoPainter(),
      ),
    );
  }
}

class _SomtelLogoPainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paintNavy = Paint()
      ..color = AppColors.secondary
      ..style = PaintingStyle.fill;

    final paintGold = Paint()
      ..color = AppColors.primary
      ..style = PaintingStyle.fill;

    final center = Offset(size.width / 2, size.height / 2);
    final radius = size.width / 2;

    // Background circle
    canvas.drawCircle(center, radius, paintNavy);

    // Signal arcs (simplified logo)
    final arcPaint = Paint()
      ..color = AppColors.primary
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.08
      ..strokeCap = StrokeCap.round;

    final rect1 = Rect.fromCenter(center: center, width: radius * 1.0, height: radius * 1.0);
    final rect2 = Rect.fromCenter(center: center, width: radius * 1.5, height: radius * 1.5);
    final rect3 = Rect.fromCenter(center: center, width: radius * 1.9, height: radius * 1.9);

    canvas.drawArc(rect1, -2.4, 1.0, false, arcPaint);
    canvas.drawArc(rect2, -2.4, 1.0, false, arcPaint);
    canvas.drawArc(rect3, -2.4, 1.0, false, arcPaint);

    // GPS dot
    canvas.drawCircle(
      Offset(center.dx - radius * 0.2, center.dy + radius * 0.1),
      radius * 0.12,
      paintGold,
    );
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
