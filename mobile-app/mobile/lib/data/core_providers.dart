import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/config/app_config.dart';
import 'package:lifestyle_mobile/data/api_client.dart';
import 'package:lifestyle_mobile/data/token_store.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_service.dart';
import 'package:lifestyle_mobile/features/ai/data/ai_transport.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  final client = ApiClient(
    baseUri: AppConfig.apiBaseUri,
    tokenStore: ref.watch(tokenStoreProvider),
  );
  // The AI facade talks to the backend proxy through this same client, so
  // session refresh and rotation rules stay in exactly one place.
  AiService.bindGateway(ApiClientAiGateway(client));
  ref.onDispose(client.close);
  return client;
});
