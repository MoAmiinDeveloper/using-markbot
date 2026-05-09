import 'package:flutter_test/flutter_test.dart';
import 'package:raadraac_installer/data/commands_data.dart';
import 'package:raadraac_installer/models/command_model.dart';

void main() {
  group('Commands Data Tests', () {
    test('All commands have required fields', () {
      for (final cmd in CommandsData.commands) {
        expect(cmd.id, isNotEmpty);
        expect(cmd.name, isNotEmpty);
        expect(cmd.nameSo, isNotEmpty);
        expect(cmd.template, isNotEmpty);
        expect(cmd.supportedModels, isNotEmpty);
      }
    });

    test('SMS generation works for APN command', () {
      final cmd = CommandsData.getById('net_set_apn');
      expect(cmd, isNotNull);
      final sms = cmd!.generateSms({'apn': 'internet', 'apn_username': '', 'apn_password': ''});
      expect(sms, contains('internet'));
      expect(sms, contains('2001'));
    });

    test('SMS generation works for server command', () {
      final cmd = CommandsData.getById('net_set_server');
      expect(cmd, isNotNull);
      final sms = cmd!.generateSms({'server': 'track.somtel.net', 'port': '21212'});
      expect(sms, contains('track.somtel.net'));
      expect(sms, contains('21212'));
    });

    test('Reboot command has no fields', () {
      final cmd = CommandsData.getById('sys_reboot');
      expect(cmd, isNotNull);
      expect(cmd!.fields, isEmpty);
      expect(cmd.generateSms({}), equals('reboot'));
    });

    test('Filter by category returns correct commands', () {
      final sysCmds = CommandsData.getByCategory(CommandCategory.system);
      expect(sysCmds, isNotEmpty);
      expect(sysCmds.every((c) => c.category == CommandCategory.system), isTrue);
    });

    test('Search works across name and description', () {
      final results = CommandsData.search('APN');
      expect(results, isNotEmpty);
      expect(results.any((c) => c.name.contains('APN')), isTrue);
    });

    test('Engine cut is marked dangerous', () {
      final cmd = CommandsData.getById('out_engine_cut');
      expect(cmd, isNotNull);
      expect(cmd!.isDangerous, isTrue);
    });
  });
}
