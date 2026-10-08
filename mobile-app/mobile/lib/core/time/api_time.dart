import 'package:flutter/material.dart';

/// Formats a local calendar date as the API's YYYY-MM-DD string.
String formatApiDate(DateTime date) {
  final year = date.year.toString().padLeft(4, '0');
  final month = date.month.toString().padLeft(2, '0');
  final day = date.day.toString().padLeft(2, '0');
  return '$year-$month-$day';
}

/// Formats a clock time as the API's HH:mm string.
String formatApiTime(TimeOfDay time) {
  final hour = time.hour.toString().padLeft(2, '0');
  final minute = time.minute.toString().padLeft(2, '0');
  return '$hour:$minute';
}

/// Parses a YYYY-MM-DD value. The result is a date with no time zone.
DateTime? parseApiDate(String? value) {
  if (value == null || value.isEmpty) return null;
  return DateTime.tryParse(value);
}

/// Strips a calendar date to midnight, so date-only comparisons are exact.
DateTime dateOnly(DateTime value) => DateTime(value.year, value.month, value.day);

/// Converts a local instant into the UTC ISO-8601 text that the API validates.
String toApiInstant(DateTime local) => local.toUtc().toIso8601String();

/// Trims trailing zeros from a decimal string: "12.5000" becomes "12.5" and "3.0000" becomes "3".
String formatDecimal(String? raw) {
  if (raw == null) return '';
  final parsed = double.tryParse(raw);
  if (parsed == null) return raw;
  if (parsed == parsed.roundToDouble()) return parsed.toInt().toString();
  return parsed.toString();
}

/// Parses an HH:mm value from the API. Returns null for anything malformed.
TimeOfDay? parseApiTime(String? value) {
  if (value == null) return null;
  final parts = value.split(':');
  if (parts.length != 2) return null;
  final hour = int.tryParse(parts[0]);
  final minute = int.tryParse(parts[1]);
  if (hour == null || minute == null) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return TimeOfDay(hour: hour, minute: minute);
}
