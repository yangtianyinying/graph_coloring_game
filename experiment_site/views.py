from django.views.generic import TemplateView


class HomeView(TemplateView):
    template_name = "experiment_site/index.html"
