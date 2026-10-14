import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:audioplayers/audioplayers.dart';

/// Plays the audio that accompanies focus and break sessions.
///
/// Two sources are supported:
///  * Built-in ambient soundscapes (rain, cafe, waves, white noise) that are
///    synthesized on the device the first time they are used, then cached as
///    small WAV loops in the temp directory. No bundled assets, no network.
///  * The user's own tracks, picked from device storage and looped.
class SessionAudioPlayer {
  SessionAudioPlayer._();

  static final SessionAudioPlayer instance = SessionAudioPlayer._();

  static const int _sampleRate = 22050;
  static const int _loopSeconds = 6;

  final AudioPlayer _player = AudioPlayer();
  String? _currentTag;

  String? get currentTag => _currentTag;

  /// Loops the built-in soundscape for [key]. `quiet` stops playback.
  Future<void> playAmbient(String key) async {
    if (key == 'quiet') {
      await stop();
      return;
    }
    final tag = 'ambient:$key';
    if (_currentTag == tag) return;
    final file = await _ambientFile(key);
    await _startLoop(file.path, tag);
  }

  /// Loops the user's own audio file at [path].
  Future<void> playSong(String path) async {
    final tag = 'song:$path';
    if (_currentTag == tag) return;
    await _startLoop(path, tag);
  }

  Future<void> stop() async {
    if (_currentTag == null) return;
    _currentTag = null;
    try {
      await _player.stop();
    } catch (_) {
      // Player was already stopped; nothing to do.
    }
  }

  Future<void> _startLoop(String path, String tag) async {
    try {
      await _player.stop();
      await _player.setReleaseMode(ReleaseMode.loop);
      await _player.setSourceDeviceFile(path);
      await _player.setVolume(0.9);
      await _player.resume();
      _currentTag = tag;
    } catch (_) {
      _currentTag = null;
    }
  }

  Future<File> _ambientFile(String key) async {
    final file = File(
      '${Directory.systemTemp.path}/lifestyle_ambient_$key.wav',
    );
    if (file.existsSync() && file.lengthSync() > 44) return file;
    await file.writeAsBytes(_synthesize(key), flush: true);
    return file;
  }

  static Uint8List _synthesize(String key) {
    const n = _sampleRate * _loopSeconds;
    final rnd = Random(1234);
    final samples = Float64List(n);
    double low = 0;
    double brown = 0;
    for (var i = 0; i < n; i++) {
      final w = rnd.nextDouble() * 2 - 1;
      final t = i / _sampleRate;
      switch (key) {
        case 'rain':
          low = 0.70 * low + 0.30 * w;
          final drop = rnd.nextDouble() < 0.0006
              ? (rnd.nextDouble() * 2 - 1) * 0.6
              : 0.0;
          samples[i] = low * 0.55 + drop;
        case 'cafe':
          low = 0.90 * low + 0.10 * w;
          final murmur = 0.65 +
              0.35 *
                  sin(2 * pi * t * 2 / _loopSeconds +
                      1.7 * sin(2 * pi * t * 5 / _loopSeconds));
          samples[i] = low * 0.9 * murmur;
        case 'waves':
          brown = (brown + 0.02 * w) / 1.02;
          final swell = 0.50 + 0.50 * sin(2 * pi * t / _loopSeconds - pi / 2);
          samples[i] = brown * 3.2 * swell;
        case 'white_noise':
          samples[i] = w * 0.40;
        default:
          samples[i] = w * 0.30;
      }
    }
    var peak = 1e-9;
    for (var i = 0; i < n; i++) {
      peak = max(peak, samples[i].abs());
    }
    final gain = 0.55 / peak;
    const fade = 512;
    for (var i = 0; i < n; i++) {
      double g = gain;
      if (i < fade) {
        g *= i / fade;
      } else if (i > n - fade) {
        g *= (n - i) / fade;
      }
      samples[i] *= g;
    }
    return _encodeWav(samples);
  }

  static Uint8List _encodeWav(Float64List samples) {
    final n = samples.length;
    final bytes = ByteData(44 + n * 2);
    void tag(int offset, String s) {
      for (var i = 0; i < s.length; i++) {
        bytes.setUint8(offset + i, s.codeUnitAt(i));
      }
    }

    tag(0, 'RIFF');
    bytes.setUint32(4, 36 + n * 2, Endian.little);
    tag(8, 'WAVE');
    tag(12, 'fmt ');
    bytes.setUint32(16, 16, Endian.little);
    bytes.setUint16(20, 1, Endian.little);
    bytes.setUint16(22, 1, Endian.little);
    bytes.setUint32(24, _sampleRate, Endian.little);
    bytes.setUint32(28, _sampleRate * 2, Endian.little);
    bytes.setUint16(32, 2, Endian.little);
    bytes.setUint16(34, 16, Endian.little);
    tag(36, 'data');
    bytes.setUint32(40, n * 2, Endian.little);
    for (var i = 0; i < n; i++) {
      var v = (samples[i] * 32767).round();
      if (v > 32767) v = 32767;
      if (v < -32768) v = -32768;
      bytes.setInt16(44 + i * 2, v, Endian.little);
    }
    return bytes.buffer.asUint8List();
  }
}
