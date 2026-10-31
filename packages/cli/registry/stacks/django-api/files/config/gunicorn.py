"""gunicorn settings, read with `gunicorn -c config/gunicorn.py` (make start, the container).

Workers come from WEB_CONCURRENCY, which gunicorn reads itself. Request logs come from
core.middleware, so gunicorn's access log stays off.
"""

import os

wsgi_app = "config.wsgi:application"
bind = f"{os.environ.get('API_HOST', '127.0.0.1')}:{int(os.environ.get('PORT_API', '8000'))}"
accesslog = None
# The control socket defaults to one path under $HOME shared by every gunicorn on the machine.
control_socket_disable = True
