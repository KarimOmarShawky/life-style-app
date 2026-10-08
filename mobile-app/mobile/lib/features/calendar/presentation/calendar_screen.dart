import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:lifestyle_mobile/core/time/api_time.dart';
import 'package:lifestyle_mobile/core/widgets/feature_widgets.dart';
import 'package:lifestyle_mobile/features/calendar/data/calendar_event_model.dart';
import 'package:lifestyle_mobile/features/calendar/presentation/event_form_screen.dart';
import 'package:lifestyle_mobile/features/calendar/state/calendar_provider.dart';
import 'package:lifestyle_mobile/l10n/app_localizations.dart';

/// Day agenda: shows the events of the selected day, with navigation between days.
class CalendarScreen extends ConsumerWidget {
  const CalendarScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final day = ref.watch(selectedCalendarDayProvider);
    final dayKey = formatApiDate(day);
    final agendaAsync = ref.watch(calendarAgendaProvider(dayKey));
    final today = dateOnly(DateTime.now());

    void moveTo(DateTime target) {
      ref.read(selectedCalendarDayProvider.notifier).state = dateOnly(target);
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.calendarTitle),
        actions: [
          if (day != today)
            TextButton(onPressed: () => moveTo(today), child: Text(l10n.today)),
        ],
      ),
      body: Column(
        children: [
          Row(
            children: [
              IconButton(
                tooltip: l10n.previousDay,
                icon: const Icon(Icons.chevron_left),
                onPressed: () =>
                    moveTo(day.subtract(const Duration(days: 1))),
              ),
              Expanded(
                child: TextButton(
                  onPressed: () async {
                    final picked = await showDatePicker(
                      context: context,
                      initialDate: day,
                      firstDate: DateTime(2000),
                      lastDate: DateTime(2100),
                    );
                    if (picked != null) moveTo(picked);
                  },
                  child: Text(
                    formatDisplayDate(context, day, emptyText: dayKey),
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              ),
              IconButton(
                tooltip: l10n.nextDay,
                icon: const Icon(Icons.chevron_right),
                onPressed: () => moveTo(day.add(const Duration(days: 1))),
              ),
            ],
          ),
          const Divider(height: 1),
          Expanded(
            child: RefreshIndicator(
              onRefresh: () async => ref.invalidate(calendarAgendaProvider(dayKey)),
              child: agendaAsync.when(
                loading: () => const Center(child: CircularProgressIndicator()),
                error: (error, _) => FeatureErrorView(
                  message: error.toString(),
                  onRetry: () => ref.invalidate(calendarAgendaProvider(dayKey)),
                ),
                data: (events) {
                  if (events.isEmpty) {
                    return ListView(
                      children: [
                        FeatureEmptyView(
                          icon: Icons.event_outlined,
                          message: l10n.noEventsForDay,
                        ),
                      ],
                    );
                  }
                  final sorted = [...events]
                    ..sort((a, b) => a.startAt.compareTo(b.startAt));
                  return ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: sorted.length,
                    itemBuilder: (context, index) {
                      final event = sorted[index];
                      return Dismissible(
                        key: ValueKey('event-${event.id}'),
                        direction: DismissDirection.endToStart,
                        background: const DeleteSwipeBackground(),
                        confirmDismiss: (_) => confirmDestructiveAction(
                          context,
                          title: l10n.deleteEventConfirm,
                          detail: event.title,
                        ),
                        onDismissed: (_) async {
                          await ref
                              .read(calendarRepositoryProvider)
                              .deleteEvent(event.id);
                          ref.invalidate(calendarAgendaProvider);
                        },
                        child: _EventTile(
                          event: event,
                          onTap: () => openEventForm(context, ref, event: event),
                        ),
                      );
                    },
                  );
                },
              ),
            ),
          ),
        ],
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => openEventForm(context, ref, initialDay: day),
        icon: const Icon(Icons.add),
        label: Text(l10n.addEvent),
      ),
    );
  }
}

class _EventTile extends StatelessWidget {
  const _EventTile({required this.event, required this.onTap});

  final CalendarEvent event;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final location = event.location;
    final timeText = event.allDay
        ? l10n.allDayLabel
        : '${formatDisplayTime(context, event.startAt)} - ${formatDisplayTime(context, event.endAt)}';
    final subtitle = location == null ? timeText : '$timeText · $location';

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: ListTile(
        onTap: onTap,
        leading: Icon(
          event.allDay ? Icons.event_available_outlined : Icons.schedule_outlined,
        ),
        title: Text(
          event.title,
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        subtitle: Text(subtitle),
      ),
    );
  }
}
