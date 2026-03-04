import csv
import time
from deep_translator import GoogleTranslator

def translate_to_si(text):
    if not text or not text.strip() or text.lower() == 'unknown':
        return "නොදනී" if text.lower() == 'unknown' else ""
    retries = 3
    for _ in range(retries):
        try:
            res = GoogleTranslator(source='en', target='si').translate(text)
            if res:
                return res
        except Exception as e:
            time.sleep(2)
            pass
    return text

def process_csv():
    in_file = 'c:/xampp/htdocs/mimir/Mimir/booklist_prepared_fixed.csv'
    out_file = 'c:/xampp/htdocs/mimir/Mimir/booklist_prepared_v3.csv'
    
    rows = []
    with open(in_file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        for r in reader:
            rows.append(r)
            
    print(f"Loaded {len(rows)} rows from {in_file}")
    
    # Headers: id, name, sinhala name, author, author sinhala name, translator, translator sinhala name, language, categoery, Tags
    
    for i, row in enumerate(rows):
        if len(row) < 10:
            print(f"Skipping malformed row {row}")
            continue
            
        name_en = row[1]
        name_si = row[2]
        author_en = row[3]
        author_si = row[4]
        trans_en = row[5]
        trans_si = row[6]
        
        updated = False
        
        # Translate Book Name if missing
        if not name_si.strip():
            row[2] = translate_to_si(name_en)
            updated = True
            
        # Translate Author if missing
        if author_en.strip() and not author_si.strip():
            row[4] = translate_to_si(author_en)
            updated = True
            
        # Translate Translator if missing
        if trans_en.strip() and not trans_si.strip():
            row[6] = translate_to_si(trans_en)
            updated = True
            
        if i % 50 == 0:
            print(f"Processed {i}/{len(rows)} records...")

    with open(out_file, 'w', encoding='utf-8', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)
        
    print(f"Finished writing {out_file}")

if __name__ == "__main__":
    process_csv()
