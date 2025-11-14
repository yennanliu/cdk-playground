from django.shortcuts import render
from rest_framework import viewsets, status
from rest_framework.response import Response
from django.core.cache import cache
from .models import Item
from .serializers import ItemSerializer
import json

# Create your views here.

class ItemViewSet(viewsets.ViewSet):
    def get_cache_key(self, item_id=None):
        return f"item:{item_id}" if item_id else "items:all"

    def list(self, request):
        # Try to get items from cache
        cached_items = cache.get(self.get_cache_key())
        if cached_items:
            return Response(json.loads(cached_items))
        
        # If not in cache, get from database
        items = Item.objects.all()
        serializer = ItemSerializer(items, many=True)
        # Cache the results for 5 minutes
        cache.set(self.get_cache_key(), json.dumps(serializer.data), timeout=300)
        return Response(serializer.data)

    def create(self, request):
        serializer = ItemSerializer(data=request.data)
        if serializer.is_valid():
            item = serializer.save()
            # Invalidate the list cache
            cache.delete(self.get_cache_key())
            # Cache the new item
            cache.set(self.get_cache_key(item.id), json.dumps(serializer.data), timeout=300)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def retrieve(self, request, pk=None):
        # Try to get item from cache
        cached_item = cache.get(self.get_cache_key(pk))
        if cached_item:
            return Response(json.loads(cached_item))
        
        try:
            item = Item.objects.get(pk=pk)
        except Item.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        
        serializer = ItemSerializer(item)
        # Cache the item for 5 minutes
        cache.set(self.get_cache_key(pk), json.dumps(serializer.data), timeout=300)
        return Response(serializer.data)

    def update(self, request, pk=None):
        try:
            item = Item.objects.get(pk=pk)
        except Item.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        
        serializer = ItemSerializer(item, data=request.data)
        if serializer.is_valid():
            serializer.save()
            # Update cache
            cache.set(self.get_cache_key(pk), json.dumps(serializer.data), timeout=300)
            # Invalidate the list cache
            cache.delete(self.get_cache_key())
            return Response(serializer.data)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def destroy(self, request, pk=None):
        try:
            item = Item.objects.get(pk=pk)
        except Item.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)
        
        item.delete()
        # Delete from cache
        cache.delete(self.get_cache_key(pk))
        # Invalidate the list cache
        cache.delete(self.get_cache_key())
        return Response(status=status.HTTP_204_NO_CONTENT)
