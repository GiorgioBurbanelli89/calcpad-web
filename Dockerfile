FROM mcr.microsoft.com/dotnet/sdk:10.0-preview AS build
WORKDIR /src
COPY Calcpad.Core/ Calcpad.Core/
COPY Calcpad.OpenXml/ Calcpad.OpenXml/
COPY Calcpad.WebApi/ Calcpad.WebApi/
RUN dotnet publish Calcpad.WebApi/Calcpad.WebApi.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0-preview
WORKDIR /app
COPY --from=build /app .
COPY public/ /app/public/
COPY Calcpad.WebApi/template.html /app/template.html
ENV ASPNETCORE_URLS=http://+:7860
EXPOSE 7860
ENTRYPOINT ["dotnet", "Calcpad.WebApi.dll"]
