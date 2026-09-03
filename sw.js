self.addEventListener(
    "push",
    event => {

        let data = {};

        try {
            data = event.data.json();
        } catch {
            data = {
                title: "Notification",
                message: event.data?.text() || ""
            };
        }


        const title =
            data.title || "New Notification";


        const options = {

            body:
                data.message ||
                "You received a notification.",

            icon:
                data.icon ||
                "icon.png",

            badge:
                data.badge ||
                "badge.png",

            data:
                data.url || "/"

        };


        event.waitUntil(

            self.registration.showNotification(
                title,
                options
            )

        );
    }
);


// --------------------------------------------------
// When notification is clicked
// --------------------------------------------------

self.addEventListener(
    "notificationclick",
    event => {

        event.notification.close();


        const url =
            event.notification.data || "/";


        event.waitUntil(

            clients.matchAll({
                type: "window",
                includeUncontrolled: true
            })
            .then(clientList => {

                for (const client of clientList) {

                    if (
                        client.url === url &&
                        "focus" in client
                    ) {
                        return client.focus();
                    }
                }


                if (clients.openWindow) {
                    return clients.openWindow(url);
                }

            })

        );
    }
);
