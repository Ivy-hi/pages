#!/bin/zsh

cd -- "$(dirname -- "$0")" || exit 1

PHOTO_PUBLISH_GUI=1 npm run photo:publish
status=$?

if [[ $status -eq 0 ]]; then
	osascript -e 'display notification "新照片已经上线。" with title "照片发布器"'
elif [[ $status -ne 130 ]]; then
	osascript -e 'display alert "照片发布已停止，请查看终端窗口中的具体原因。" as critical'
fi

exit $status
