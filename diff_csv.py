import csv

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
    return data, row_count

orig_data, orig_count = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist.csv')
prep_data, prep_count = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist_prepared.csv')

print(f"Original row count: {orig_count}")
print(f"Prepared row count: {prep_count}")

missing_ids = set(orig_data.keys()) - set(prep_data.keys())
extra_ids = set(prep_data.keys()) - set(orig_data.keys())

print(f"Missing IDs: {len(missing_ids)} -> {sorted(list(missing_ids))[:20]}")
print(f"Extra IDs: {len(extra_ids)}")

mismatched_names = 0
for id_val in orig_data.keys():
    if id_val in prep_data:
        orig_name = orig_data[id_val][1].strip()
        prep_name = prep_data[id_val][1].strip()
        if orig_name != prep_name:
            print(f"Mismatch at ID {id_val}: Orig='{orig_name}', Prep='{prep_name}'")
            mismatched_names += 1
            if mismatched_names > 20: break
        
print(f"Total mismatched names checked (first 20 shown): {mismatched_names}")
