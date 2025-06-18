from django.contrib import admin
from django.urls import path
from django.http import HttpResponse

def index(request):
    return HttpResponse("Hello, world. This is a minimal Django app.")

urlpatterns = [
    path('admin/', admin.site.urls),
    path('', index),
]
