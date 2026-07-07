with open("src/pages/AdminDashboard.jsx", "r", encoding="cp1256") as f:
    lines = f.readlines()

button_lines = lines[5736:5759]
print("Exact lines of button:")
for idx, line in enumerate(button_lines):
    print(f"{idx}: {repr(line.encode('utf-8'))}")

button_text = "".join(button_lines)
print("\nRepresentation of button text:")
print(repr(button_text.encode('utf-8')))
