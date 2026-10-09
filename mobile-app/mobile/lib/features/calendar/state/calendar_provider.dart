import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/data/core_providers.dart';
import 'package:lifestyle_mobile/features/auth/state/auth_provider.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_repository.dart';

final calendarRepositoryProvider = Provider<CalendarRepository>(
  (ref) => CalendarRepository(ref.watch(apiClientProvider)),
);

/// The calendar day currently shown (date only).
final selectedCalendarDayProvider = StateProvider<DateTime>(
  (ref) => dateOnly(DateTime.now()),
);

/// Agenda for one day, keyed by YYYY-MM-DD.
final calendarAgendaProvider = FutureProvider.autoDispose
    .family<List<CalendarEvent>, String>((ref, date) async {
      final currentUserId = ref.watch(
        authProvider.select((value) => value.asData?.value?.id),
      );
      if (currentUserId == null) return const [];
      return ref.watch(calendarRepositoryProvider).getAgenda(date);
    });

final eventRemindersProvider = FutureProvider.autoDispose
    .family<List<CalendarReminder>, String>((ref, eventId) {
      return ref.watch(calendarRepositoryProvider).listReminders(eventId);
    });
