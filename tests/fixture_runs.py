"""Structurally valid saved predictions, including deliberate semantic mistakes.

Import/export and comparison tests must exercise historical wrong judgments too.
Live grounding and retry behavior are tested separately with real scoring calls.
"""
import copy

import engine


def stored_prediction(conversation, rubric, judgments, model='unit-test-model'):
    turns = engine.numbered_turns(conversation)
    settings = engine.inference_settings()
    return {
        'conversation_id': conversation['conversation_id'],
        'rubric': copy.deepcopy(rubric), 'judgments': copy.deepcopy(judgments),
        'score': engine.calculate(rubric, {key: row['answer'] for key, row in judgments.items()}),
        'audit': {
            'model': model, 'provider': engine.provider_name(), 'prompt': engine.PROMPT_VERSION,
            'created_at': '2026-11-08T00:00:00+00:00',
            'input_sha256': engine.fingerprint(turns), 'rubric_sha256': engine.fingerprint(rubric),
            'context_sha256': engine.fingerprint({'channel': conversation['channel'],
                'language': conversation['language'], 'messages': turns}),
            'settings': settings, 'settings_sha256': engine.fingerprint(settings),
        },
    }
