# Item sprites

Drop a picture here named after the item's id and the website uses it instead of the
drawn icon, everywhere the item appears (shop, bag, item menu, purchase cutscene):

    mushroom.png  golden-mushroom.png  slow-mushroom.png  fast-mushroom.png
    reroll-block.png  magic-lamp.png  star-compass.png  guard-charm.png
    poison-mushroom.png  boo-bell.png

`.png`, `.webp` or `.svg`, square, transparent background, about 256×256. Items
without a file keep their drawn icon. Rebuild the site (`npm run build -w @everest/web`)
after adding one; the dev server picks them up on its own.
