import csv
import json

def read_csv(file):
    data = {}
    row_count = 0
    with open(file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        for row in reader:
            if not row: continue
            row_count += 1
            if len(row) > 0:
                id_val = row[0]
                data[id_val] = row
    return data, row_count, headers

orig_data, _, orig_headers = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist.csv')
prep_data, _, prep_headers = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist_prepared.csv')

output_rows = []
out_headers = ["id", "name", "sinhala name", "author", "author sinhala name", "translator", "translator sinhala name", "language", "categoery", "Tags"]

matched = 0
mismatched = 0
missing = []

# For reference, orig headers: id,name,author,translator,language,categoery
# prep headers: id,name,sinhala name,author,author sinhala name,translator,translator sinhala name,language,categoery,Tags

for id_val, orig_row in orig_data.items():
    orig_name = orig_row[1].strip()
    orig_author = orig_row[2].strip() if len(orig_row) > 2 else ""
    orig_trans = orig_row[3].strip() if len(orig_row) > 3 else ""
    orig_lang = orig_row[4].strip() if len(orig_row) > 4 else ""
    orig_cat = orig_row[5].strip() if len(orig_row) > 5 else ""

    prep_row = prep_data.get(id_val)
    if prep_row and len(prep_row) >= 10:
        prep_name = prep_row[1].strip()
        if orig_name.lower().replace(" ", "") == prep_name.lower().replace(" ", ""):
            # It's a match! Keep translations
            # Ensure the base English details match the original precisely
            new_row = [
                id_val, 
                orig_name, 
                prep_row[2], # sinhala name 
                orig_author, 
                prep_row[4], # author sinhala
                orig_trans, 
                prep_row[6], # trans sinhala
                orig_lang, 
                orig_cat, 
                prep_row[9]  # Tags
            ]
            output_rows.append(new_row)
            matched += 1
        else:
            missing.append(id_val)
            mismatched += 1
    else:
        missing.append(id_val)
        mismatched += 1

print(f"Matched correctly: {matched}")
print(f"Mismatched/Missing: {mismatched}")

with open('c:/xampp/htdocs/mimir/Mimir/missing_ids.json', 'w') as f:
    json.dump(missing, f)

# Write the partial merged list
with open('c:/xampp/htdocs/mimir/Mimir/booklist_prepared_v2.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(out_headers)
    for r in output_rows:
        writer.writerow(r)

