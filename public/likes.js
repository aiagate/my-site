const like = document.querySelector("[data-like-slug]");

if (like instanceof HTMLElement) {
	const button = like.querySelector("button");
	const count = like.querySelector("[data-like-count]");
	const message = like.querySelector("[data-like-message]");
	const slug = like.dataset.likeSlug;

	if (
		button instanceof HTMLButtonElement &&
		count instanceof HTMLElement &&
		message instanceof HTMLElement &&
		slug
	) {
		button.addEventListener("click", async () => {
			button.disabled = true;
			message.textContent = "";

			try {
				const response = await fetch(`/api/likes/${encodeURIComponent(slug)}`, {
					method: "POST",
				});

				if (!response.ok) {
					throw new Error("Like request failed");
				}

				const body = await response.json();
				count.textContent = String(body.count);
				message.textContent = "いいねしました。";
			} catch {
				message.textContent =
					"いいねに失敗しました。反映済みの可能性があります。";
			} finally {
				button.disabled = false;
			}
		});

		void (async () => {
			try {
				const response = await fetch(`/api/likes/${encodeURIComponent(slug)}`);

				if (!response.ok) {
					return;
				}

				const body = await response.json();
				count.textContent = String(body.count);
			} catch {
				// The button remains usable when loading the current count fails.
			}
		})();
	}
}
