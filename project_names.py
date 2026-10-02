"""Venture ids -> display names. Single source of truth, imported by main.py and decision_trace.py."""

PROJECT_NAMES = {
    # Real Estate (30-50%)
    "kakoba": "Kakoba Land", "apartments": "Apartments",
    # Farming & Agriculture (20-40%)
    "chicken": "Free Range Chicken", "dairy": "Dairy / Cows", "goats": "Goats",
    "sheep": "Sheep (Dorper)", "rabbits": "Rabbits", "bees": "Apiary",
    "trees": "Tree Planting", "mango": "Mangoes & Oranges", "irrigation": "Irrigation & Bananas",
    # Business Ventures (10-30%)
    "washing_bay": "Washing Bay", "hotels": "Hotels / Cottages / Lodges", "restaurants": "Restaurants",
    # Unit Trusts (5-15%)
    "unit_trusts": "Unit Trusts", "fortune_credit": "Fortune Credit",
    # Government Securities (5-15%) / Cash (0-10%)
    "govt_securities": "Government Securities", "cash": "Cash & Equivalents",
}

# Conservative keywords for tagging free text (meeting minutes bullets) to ONE venture. Whole words only;
# a bullet matching zero or several ventures is left untagged. Deliberately omits generic ventures (cash).
PROJECT_KEYWORDS = {
    "kakoba": ["kakoba"], "apartments": ["apartment", "apartments"],
    "chicken": ["chicken", "chickens", "poultry"], "dairy": ["dairy", "cow", "cows", "cattle"],
    "goats": ["goat", "goats"], "sheep": ["sheep", "dorper"], "rabbits": ["rabbit", "rabbits"],
    "bees": ["bee", "bees", "apiary", "beehive", "beehives"], "trees": ["eucalyptus", "tree planting"],
    "mango": ["mango", "mangoes", "mangos"], "irrigation": ["irrigation", "banana", "bananas"],
    "washing_bay": ["washing bay", "car wash"], "hotels": ["hotel", "hotels", "cottage", "cottages", "lodge", "lodges"],
    "restaurants": ["restaurant", "restaurants"], "unit_trusts": ["unit trust", "unit trusts"],
    "fortune_credit": ["fortune credit"], "govt_securities": ["treasury bill", "treasury bills", "treasury bond", "treasury bonds"],
}
