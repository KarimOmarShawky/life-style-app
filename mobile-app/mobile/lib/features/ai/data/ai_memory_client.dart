import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/ai/data/text_limits.dart';

/// Server limits for saved notes (backend `AI_MEMORY_LIMITS`, Hybrid AI
/// AI-3): characters per note, active notes per account, and how many the
/// assistant reads (`AI_MEMORY_CONTEXT_CAPS`).
const int aiMemoryMaxChars = 500;
const int aiMemoryMaxActive = 100;
const int aiMemoryContextItems = 30;

/// What a saved note is about (backend `AI_MEMORY_KINDS`).
enum AiMemoryKind { preference, fact }

/// A note the user saved for the assistant to remember (AI-3). Only the user
/// writes notes; the assistant never does.
class AiMemory {
  const AiMemory({
    required this.id,
    required this.kind,
    required this.content,
  });

  /// Parses one item of `/ai/memories`. Throws a [FormatException] when the
  /// shape is not the expected one.
  factory AiMemory.fromJson(Object? json) {
    if (json is Map<String, dynamic>) {
      final id = json['id'];
      final kind = json['kind'];
      final content = json['content'];
      if (id is String && kind is String && content is String) {
        for (final value in AiMemoryKind.values) {
          if (value.name == kind) {
            return AiMemory(id: id, kind: value, content: content);
          }
        }
      }
    }
    throw const FormatException('Unexpected AI memory');
  }

  final String id;
  final AiMemoryKind kind;
  final String content;
}

/// The account's saved notes as `GET /ai/memories` returns them.
class AiMemoryList {
  const AiMemoryList({required this.items, required this.available});

  factory AiMemoryList.fromJson(Object? json) {
    if (json is Map<String, dynamic>) {
      final items = json['items'];
      final available = json['available'];
      if (items is List<dynamic> && available is bool) {
        return AiMemoryList(
          items: [for (final item in items) AiMemory.fromJson(item)],
          available: available,
        );
      }
    }
    throw const FormatException('Unexpected AI memory list');
  }

  final List<AiMemory> items;

  /// False until the owner-run SQL has created the table; then nothing can
  /// be saved.
  final bool available;
}

/// Saved notes for the assistant (`/ai/memories`, Hybrid AI AI-3).
abstract interface class AiMemoryClient {
  Future<AiMemoryList> list();

  Future<AiMemory> create({
    required AiMemoryKind kind,
    required String content,
  });

  Future<AiMemory> update(
    String id, {
    required AiMemoryKind kind,
    required String content,
  });

  Future<void> delete(String id);

  /// Deletes every note of the account; returns how many were deleted.
  Future<int> deleteAll();
}

class ApiAiMemoryClient implements AiMemoryClient {
  ApiAiMemoryClient(this._api);

  final ApiClient _api;

  @override
  Future<AiMemoryList> list() async =>
      AiMemoryList.fromJson(await _api.get('ai/memories'));

  @override
  Future<AiMemory> create({
    required AiMemoryKind kind,
    required String content,
  }) async =>
      AiMemory.fromJson(
        await _api.post(
          'ai/memories',
          body: <String, Object?>{
            'kind': kind.name,
            'content': clampUtf16(content.trim(), aiMemoryMaxChars),
          },
        ),
      );

  @override
  Future<AiMemory> update(
    String id, {
    required AiMemoryKind kind,
    required String content,
  }) async =>
      AiMemory.fromJson(
        await _api.patch(
          'ai/memories/${Uri.encodeComponent(id)}',
          body: <String, Object?>{
            'kind': kind.name,
            'content': clampUtf16(content.trim(), aiMemoryMaxChars),
          },
        ),
      );

  @override
  Future<void> delete(String id) async {
    await _api.delete('ai/memories/${Uri.encodeComponent(id)}');
  }

  @override
  Future<int> deleteAll() async {
    final result = await _api.delete('ai/memories');
    if (result is Map<String, dynamic>) {
      final deleted = result['deleted'];
      if (deleted is int) return deleted;
    }
    return 0;
  }
}

final aiMemoryClientProvider = Provider<AiMemoryClient>(
  (ref) => ApiAiMemoryClient(ref.watch(apiClientProvider)),
);
