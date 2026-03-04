import csv

def read_csv(file):
    data = {}
    with open(file, 'r', encoding='utf-8') as f:
        reader = csv.reader(f)
        headers = next(reader)
        for row in reader:
            if not row: continue
            if len(row) > 0:
                data[row[0]] = row
    return data, headers

orig_data, orig_headers = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist.csv')
prep_data, prep_headers = read_csv('c:/xampp/htdocs/mimir/Mimir/booklist_prepared.csv')

out_headers = ["id", "name", "sinhala name", "author", "author sinhala name", "translator", "translator sinhala name", "language", "categoery", "Tags"]

author_map = {}
trans_map = {}

# Build map from existing valid ones in booklist_prepared.csv
for id_val, prep_row in prep_data.items():
    if len(prep_row) >= 10:
        orig_row = orig_data.get(id_val)
        if orig_row:
            orig_name = orig_row[1].strip()
            prep_name = prep_row[1].strip()
            # If names match, it's a valid row
            if orig_name.lower().replace(" ", "") == prep_name.lower().replace(" ", ""):
                e_author = orig_row[2].strip() if len(orig_row) > 2 else ""
                s_author = prep_row[4].strip()
                if e_author and s_author and e_author.lower() != 'unknown':
                    author_map[e_author.lower()] = s_author
                
                e_trans = orig_row[3].strip() if len(orig_row) > 3 else ""
                s_trans = prep_row[6].strip()
                if e_trans and s_trans and e_trans.lower() != 'unknown':
                    trans_map[e_trans.lower()] = s_trans

# Add some common manual overrides based on previously seen items
manual_authors = {
    'frederick forsyth': 'ෆ්‍රෙඩ්රික් ෆෝසයිත්',
    'federick forsyth': 'ෆ්‍රෙඩ්රික් ෆෝසයිත්',
    'agatha christie': 'ඇගතා ක්‍රිස්ටි',
    'edgar rice burroughs': 'එඩ්ගර් රයිස් බරෝස්',
    'sir arthur conan doyle': 'ශ්‍රීමත් ආතර් කොනන් ඩොයිල්',
    'enid blyton': 'ඊනිඞ් බ්ලයිටන්',
    'charles dickens': 'චාල්ස් ඩිකන්ස්',
    'mark twain': 'මාර්ක් ටුවෙන්'
}
author_map.update(manual_authors)

manual_trans = {
    'ananda sellahewa': 'ආනන්ද සෙල්ලහේවා',
    'chandana mendis': 'චන්දන මෙන්ඩිස්',
    'k.g. karunathilaka': 'කේ.ජී. කරුණාතිලක',
    'lasitha ravin umagiliya': 'ලසිත රවීන් උමගිලිය',
    'deemon ananda': 'ඩීමන් ආනන්ද'
}
trans_map.update(manual_trans)

output_rows = []

for id_val, orig_row in orig_data.items():
    orig_name = orig_row[1].strip()
    orig_author = orig_row[2].strip() if len(orig_row) > 2 else ""
    orig_trans = orig_row[3].strip() if len(orig_row) > 3 else ""
    orig_lang = orig_row[4].strip() if len(orig_row) > 4 else ""
    orig_cat = orig_row[5].strip() if len(orig_row) > 5 else ""

    prep_row = prep_data.get(id_val)
    is_valid = False
    
    if prep_row and len(prep_row) >= 10:
        prep_name = prep_row[1].strip()
        if orig_name.lower().replace(" ", "") == prep_name.lower().replace(" ", ""):
            is_valid = True
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

    if not is_valid:
        # We must reconstruct this row from the original data
        s_auth = author_map.get(orig_author.lower(), "")
        if not s_auth and orig_author.lower() == 'unknown': s_auth = 'නොදනී'
        
        s_trans = trans_map.get(orig_trans.lower(), "")
        if not s_trans and orig_trans.lower() == 'unknown': s_trans = 'නොදනී'
        
        # We can't safely translate the title. We just keep the english title or leave blank.
        s_title = orig_name if orig_lang.lower() == 'sinhala' else ""
        
        # Tags we don't have, so we can try to guess or leave blank.
        tags = ""
        if "Novel" in orig_cat: tags = "Novel"
        elif "Short" in orig_cat: tags = "Short Stories"
        
        new_row = [
            id_val,
            orig_name,
            s_title,       # sinhala name
            orig_author,
            s_auth,        # author sinhala
            orig_trans,
            s_trans,       # trans sinhala
            orig_lang,
            orig_cat,
            tags           # Tags
        ]
        output_rows.append(new_row)

# Sort by integer ID
output_rows.sort(key=lambda x: int(x[0]))

with open('c:/xampp/htdocs/mimir/Mimir/booklist_prepared_fixed.csv', 'w', encoding='utf-8', newline='') as f:
    writer = csv.writer(f)
    writer.writerow(out_headers)
    for r in output_rows:
        writer.writerow(r)

print("Generated booklist_prepared_fixed.csv")
