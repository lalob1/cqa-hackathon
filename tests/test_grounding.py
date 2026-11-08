"""Role evidence checks reject unsupported claims, never insert reference answers."""
import copy
import json
import unittest

import engine


class GroundingTests(unittest.TestCase):
    def setUp(self):
        self.conversation = {"conversation_id": "role-test", "channel": "agent chat", "language": "RU",
                             "transcript": [
                                 {"timestamp": "00:00", "speaker": "client", "text": "Где найти отчёт?"},
                                 {"timestamp": "00:01", "speaker": "bot", "text": "Здравствуйте, я бот."},
                                 {"timestamp": "00:02", "speaker": "operator", "text": "Здравствуйте! Я Анна. Откройте меню."}]}
        self.rubric = [copy.deepcopy(engine.DEFAULT_RUBRIC[0])]

    def judgment(self, turn, answer="yes"):
        return {"greeting": {"answer": answer, "reason": "Проверена реплика.", "evidence": [{"start": turn, "end": turn}]}}

    def test_bot_greeting_cannot_prove_operator_greeting(self):
        with self.assertRaisesRegex(ValueError, "NO operator"):
            engine.validate_operator_evidence(self.judgment(2), self.rubric, self.conversation)
        engine.validate_operator_evidence(self.judgment(3), self.rubric, self.conversation)

    def test_later_operator_greeting_does_not_prove_first_response(self):
        self.conversation["transcript"].append({"timestamp": "00:03", "speaker": "operator", "text": "Добрый день."})
        with self.assertRaisesRegex(ValueError, "FIRST operator"):
            engine.validate_operator_evidence(self.judgment(4), self.rubric, self.conversation)

    def test_changed_criterion_is_governed_by_its_new_rule(self):
        self.rubric[0]["rule"] = "Бот поздоровался."
        engine.validate_operator_evidence(self.judgment(2), self.rubric, self.conversation)

    def test_model_repairs_evidence_without_reference_labels(self):
        calls = []

        def chat(messages, schema):
            calls.append(copy.deepcopy(messages))
            return {"message": {"content": json.dumps(self.judgment(2 if len(calls) == 1 else 3))}}

        result = engine.score_conversation(self.conversation, self.rubric, chat)
        self.assertEqual(result["audit"]["attempts"], 2)
        self.assertIn("NO operator", calls[1][-1]["content"])
        self.assertEqual(result["judgments"]["greeting"]["evidence"], [{"start": 3, "end": 3}])

    def test_repeated_role_error_fails_instead_of_becoming_a_score(self):
        with self.assertRaisesRegex(engine.ModelError, "NO operator"):
            engine.score_conversation(self.conversation, self.rubric,
                                      lambda *_: {"message": {"content": json.dumps(self.judgment(2))}})

    def criterion(self, key, answer, turn):
        rubric = [copy.deepcopy(next(item for item in engine.DEFAULT_RUBRIC if item['id'] == key))]
        judgment = {key: {'answer': answer, 'reason': 'Проверенный фрагмент.', 'evidence': [{'start': turn, 'end': turn}]}}
        return rubric, judgment

    def test_answer_without_clarification_cannot_prove_discovery(self):
        rubric, judgment = self.criterion('needs', 'yes', 3)
        with self.assertRaisesRegex(ValueError, 'no operator clarification'):
            engine.validate_operator_evidence(judgment, rubric, self.conversation)
        self.conversation['transcript'][2]['text'] = 'Уточните, за какой период нужен отчёт?'
        engine.validate_operator_evidence(judgment, rubric, self.conversation)

    def test_farewell_formula_alone_does_not_prove_both_closing_actions(self):
        rubric, judgment = self.criterion('closing', 'yes', 3)
        for text in ('Пожалуйста. Хорошего дня!', 'Сау болыңыз!', "You're welcome. Take care!"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'only thanks/farewell'):
                self.conversation['transcript'][2]['text'] = text
                engine.validate_operator_evidence(judgment, rubric, self.conversation)
        self.conversation['transcript'][2]['text'] = 'Итак, скачайте отчёт за нужный период. До свидания!'
        engine.validate_operator_evidence(judgment, rubric, self.conversation)

    def test_unverified_account_status_is_not_identity_na_or_absent_critical(self):
        examples = ('Я вижу на вашем счёте ограничение на вывод.',
                    'I can see your account has a withdrawal restriction.',
                    'Сіздің шотыңызда ақша шығаруға шектеу қойылғанын көріп тұрмын.')
        for text in examples:
            self.conversation['transcript'][2]['text'] = text
            for key, answer in (('identity', 'na'), ('identity', 'yes'), ('critical', 'no')):
                rubric, judgment = self.criterion(key, answer, 3)
                with self.subTest(text=text, key=key), self.assertRaisesRegex(ValueError, 'no prior confirmed verification'):
                    engine.validate_operator_evidence(judgment, rubric, self.conversation)
            for key, answer in (('identity', 'no'), ('critical', 'yes')):
                rubric, judgment = self.criterion(key, answer, 3)
                engine.validate_operator_evidence(judgment, rubric, self.conversation)

    def test_confirmed_identity_must_precede_protected_disclosure(self):
        self.conversation['transcript'][2]['text'] = 'I can see your account has a withdrawal restriction.'
        confirmation = {'timestamp': '00:03', 'speaker': 'system', 'text': 'Identity verified.'}
        self.conversation['transcript'].append(confirmation)
        rubric, judgment = self.criterion('identity', 'yes', 3)
        with self.assertRaisesRegex(ValueError, 'no prior confirmed verification'):
            engine.validate_operator_evidence(judgment, rubric, self.conversation)
        self.conversation['transcript'].insert(2, self.conversation['transcript'].pop())
        rubric, judgment = self.criterion('identity', 'yes', 4)
        engine.validate_operator_evidence(judgment, rubric, self.conversation)


if __name__ == "__main__":
    unittest.main()
