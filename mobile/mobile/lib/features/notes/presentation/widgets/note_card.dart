import 'package:flutter/material.dart';
import 'package:lifestyle_mobile/features/notes/data/note_model.dart';

class NoteCard extends StatelessWidget {
  const NoteCard({super.key, required this.note});

  final Note note;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.symmetric(vertical: 6),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                if (note.isPinned) ...[
                  const Icon(
                    Icons.push_pin,
                    size: 16,
                    color: Color(0xFF315C4C),
                  ),
                  const SizedBox(width: 4),
                ],
                Expanded(
                  child: Text(
                    note.title,
                    style: const TextStyle(
                      fontWeight: FontWeight.bold,
                      fontSize: 16,
                    ),
                  ),
                ),
              ],
            ),
            if (note.body.isNotEmpty) ...[
              const SizedBox(height: 8),
              Text(
                note.body,
                maxLines: 3,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: Colors.grey[700]),
              ),
            ],
            if (note.tags.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 6,
                children: note.tags
                    .map(
                      (t) => Chip(
                        label: Text(
                          '#$t',
                          style: const TextStyle(fontSize: 11),
                        ),
                        padding: EdgeInsets.zero,
                        materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                      ),
                    )
                    .toList(),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
