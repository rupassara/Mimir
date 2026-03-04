from deep_translator import GoogleTranslator
import time

def t(text):
    if not text.strip(): return ""
    retries = 3
    for _ in range(retries):
        try:
            return GoogleTranslator(source='en', target='si').translate(text)
        except Exception as e:
            time.sleep(2)
            pass
    return ""

print("Test: " + t("Housemaid"))
print("Test: " + t("David Baldacci"))
