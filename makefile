
default:
	echo "Usage: make [preview|organise|serve]"

serve:
	python -m http.server --directory docs 8000

preview:
	node preview.js docs/models/

organise:
	node organise.js docs/models/

rebase:
	git reset --soft $(git rev-list --max-parents=0 HEAD)
