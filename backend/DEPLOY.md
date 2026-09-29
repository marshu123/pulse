# Free plan note: Render's free web services sleep after 15 minutes of
# inactivity, so the first request after a quiet period takes a few seconds
# while it wakes up. The scheduler also pauses while asleep, which means a free
# tier cannot do true one-minute monitoring. Raise PROBE_INTERVAL_SECONDS, or
# use a paid instance, if you need reliable scheduling.
